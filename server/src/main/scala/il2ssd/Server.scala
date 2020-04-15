package il2ssd

import cats.effect._
import com.typesafe.scalalogging._
import io.circe._
import io.circe.Codec
import io.circe.derivation._
import io.circe.parser.decode
import io.circe.syntax._
import io.chrisdavenport.log4cats.slf4j.Slf4jLogger
import io.vertx.core._
import io.vertx.core.buffer.Buffer
import io.vertx.core.http.ServerWebSocket
import io.vertx.core.net.{ NetClientOptions, NetSocket }
import io.vertx.ext.web.Router
import io.vertx.ext.web.handler.StaticHandler
import java.util.regex.Matcher
import monix.execution.{ Scheduler, UncaughtExceptionReporter }
import monix.eval._
import monix.reactive._
import org.apache.commons.text.StringEscapeUtils
import vertices._
import vertices.core._

object Server extends TaskApp {
  val logger = Logger[Server.type]
  val taskLogger = Slf4jLogger.getLogger[Task]

  val exceptionHandler: Handler[Throwable] = t => logger.error("Uncaught exception", t)
  val uncaughtExceptionReporter = UncaughtExceptionReporter(exceptionHandler.handle)
  val IOScheduler = Scheduler.io("il2ssd-io", reporter = uncaughtExceptionReporter)

  val TypeField = Some("type")

  sealed abstract class ServerMessage extends Product with Serializable
  case class ConsoleMessage(message: String) extends ServerMessage
  case class PilotJoinMessage(socket: Int, ip: String, port: Int, name: String) extends ServerMessage
  case class PilotLeaveMessage(socket: Int, ip: String, port: Int) extends ServerMessage
  case class MissionPlayingMessage(mission: String) extends ServerMessage
  case class MissionLoadedMessage(mission: String) extends ServerMessage
  case class MissionNotLoadedMessage() extends ServerMessage
  case class DifficultyMessage(setting: String, enabled: Boolean) extends ServerMessage
  object ServerMessage {
    implicit val codec: Codec.AsObject[ServerMessage] = deriveCodec(identity, false, TypeField)
    implicit val consoleCodec: Codec.AsObject[ConsoleMessage] = deriveCodec(identity, false, TypeField)
    implicit val pilotJoinCodec: Codec.AsObject[PilotJoinMessage] = deriveCodec(identity, false, TypeField)
    implicit val pilotLeaveCodec: Codec.AsObject[PilotLeaveMessage] = deriveCodec(identity, false, TypeField)
    implicit val missionPlayingCodec: Codec.AsObject[MissionPlayingMessage] = deriveCodec(identity, false, TypeField)
    implicit val missionLoadedCodec: Codec.AsObject[MissionLoadedMessage] = deriveCodec(identity, false, TypeField)
    implicit val missionNotLoadedCodec: Codec.AsObject[MissionNotLoadedMessage] = deriveCodec(identity, false, TypeField)
    implicit val difficultyCodec: Codec.AsObject[DifficultyMessage] = deriveCodec(identity, false, TypeField)
    def console(message: String): ServerMessage =
      ConsoleMessage(message)
    def pilotJoin(socket: Int, ip: String, port: Int, name: String): ServerMessage =
      PilotJoinMessage(socket, ip, port, name)
    def pilotLeave(socket: Int, ip: String, port: Int): ServerMessage =
      PilotLeaveMessage(socket, ip, port)
    def missionPlaying(mission: String): ServerMessage =
      MissionPlayingMessage(mission)
    def missionLoaded(mission: String): ServerMessage =
      MissionLoadedMessage(mission)
    val missionNotLoaded: ServerMessage =
      MissionNotLoadedMessage()
    def difficulty(setting: String, enabled: Boolean): ServerMessage =
      DifficultyMessage(setting, enabled)
  }

  sealed abstract class ClientMessage extends Product with Serializable
  case class ConsoleCommand(command: String) extends ClientMessage
  object ClientMessage {
    implicit val codec: Codec.AsObject[ClientMessage] = deriveCodec(identity, false, TypeField)
    implicit val consoleCodec: Codec.AsObject[ConsoleCommand] = deriveCodec(identity, false, TypeField)
  }

  def bufferLines(dataBuffers: Observable[Buffer]): Observable[String] = {
    dataBuffers.mapAccumulate("") {
      case (currentLine, buffer) =>
      val bufferText = buffer.toString()
      val lineEnding = """(?=[\r\n])\r?\n?"""
      val bufferLines = bufferText.split(lineEnding, -1)
      if (bufferLines.length <= 1) {
        (currentLine + bufferText, Observable.empty[String])
      } else {
        val restOfCurrentLine = bufferLines.head
        val completedLine = currentLine + restOfCurrentLine
        val moreCompleteLines = bufferLines.drop(1).dropRight(1)
        val incompleteLine = bufferLines.last
        (incompleteLine, Observable.fromIterable(completedLine +: moreCompleteLines))
      }
    }.flatten
  }

  def handleClientMessage(uiSocket: ServerWebSocket, il2ServerSocket: NetSocket): Handler[String] = { message: String =>
    val decoded = decode[ClientMessage](message)

    decoded.foreach {
      case ConsoleCommand(command) =>
        il2ServerSocket.write(command + "\n")
      case _ =>
    }

    decoded.swap.foreach {
      case parsing: ParsingFailure =>
        println(parsing.message)
      case decoding: DecodingFailure =>
        println(decoding.message)
    }
  }

  def consoleMessages(il2ServerLines: Observable[String]): Observable[ServerMessage] = {
    il2ServerLines.map { messageText =>
      val sanitisedText = StringEscapeUtils.unescapeJava(messageText)
      val promptSymbol = Matcher.quoteReplacement("$\n")
      val withPrompt = sanitisedText.replaceAll("""<consoleN><\d+>""", promptSymbol)
      ServerMessage.console(withPrompt)
    }
  }

  def pilotMessages(il2ServerLines: Observable[String]): Observable[ServerMessage] = {
    val MatchPilotJoinMessage = """socket channel '(\d+)', ip (\d+{1,3}(?:\.\d{1,3}){3}):(\d+), (\S+), is complete created\\n""".r
    val MatchPilotLeaveMessage = """socketConnection with (\d+{1,3}(?:\.\d{1,3}){3}):(\d+) on channel (\d+) lost\.  Reason:.*\\n""".r
    il2ServerLines.collect {
      case MatchPilotJoinMessage(socket, ip, port, name) =>
        PilotJoinMessage(socket.toInt, ip, port.toInt, name)
      case MatchPilotLeaveMessage(ip, port, socket) =>
        PilotLeaveMessage(socket.toInt, ip, port.toInt)
    }
  }

  def missionMessages(il2ServerLines: Observable[String]): Observable[ServerMessage] = {
    val MatchMissionPlayingMessage = """Mission: (.+\.mis) is Playing\\n""".r
    val MatchMissionLoadedMessage = """Mission: (.+\.mis) is Loaded\\n""".r
    val MatchMissionNotLoadedMessage = """Mission NOT loaded\\n""".r
    il2ServerLines.collect {
      case MatchMissionPlayingMessage(mission) =>
        MissionPlayingMessage(mission)
      case MatchMissionLoadedMessage(mission) =>
        MissionLoadedMessage(mission)
      case MatchMissionNotLoadedMessage() =>
        MissionNotLoadedMessage()
    }
  }

  def difficultyMessages(il2ServerLines: Observable[String]): Observable[ServerMessage] = {
    val MatchDifficultyMessage = """\\u0020 ([A-Za-z0-9_]+)\s*(0|1)\\n""".r
    il2ServerLines.collect {
      case MatchDifficultyMessage(setting, "0") =>
        DifficultyMessage(setting, false)
      case MatchDifficultyMessage(setting, "1") =>
        DifficultyMessage(setting, true)
    }
  }

  def serverMessages(il2ServerData: Observable[Buffer]): Observable[ServerMessage] = {
    val il2ServerLines = bufferLines(il2ServerData).dump("server lines")
    Observable(
      consoleMessages(il2ServerLines),
      pilotMessages(il2ServerLines),
      missionMessages(il2ServerLines),
      difficultyMessages(il2ServerLines),
    ).merge
  }

  def handleWebsocketConnection(il2ServerSocket: NetSocket, il2ServerMessages: Observable[ServerMessage]): Handler[ServerWebSocket] = { uiSocket: ServerWebSocket =>
    val sendServerMessages = il2ServerMessages
      .map(_.asJson.noSpaces)
      .mapEval(uiSocket.writeTextMessageL)
      .lastL.runToFuture(IOScheduler)

    uiSocket.endHandler(_ => sendServerMessages.cancel())

    uiSocket.textMessageHandler(handleClientMessage(uiSocket, il2ServerSocket))
  }

  def run(args: List[String]): Task[ExitCode] = {
    val vertx = Vertx.vertx.exceptionHandler(exceptionHandler)
    val netClient = vertx.createNetClient(new NetClientOptions().setTcpKeepAlive(true))
    val httpServer = vertx.createHttpServer

    val router = Router.router(vertx)

    router.route()
      .handler(StaticHandler.create()
        .setCachingEnabled(false)
        .setIncludeHidden(false))

    for {
      il2ServerSocket <- netClient.connectL(20000, args(0))

      _ <- taskLogger.info(s"Connected to ${args(0)}")

      il2ServerStream <- il2ServerSocket.toObservable(vertx)

      il2ServerMessages = serverMessages(il2ServerStream).publish(IOScheduler)

      produceServerMessages = il2ServerMessages.connect()

      _ = httpServer.requestHandler(router.handle)

      _ = httpServer.webSocketHandler(handleWebsocketConnection(il2ServerSocket, il2ServerMessages))

      _ <- httpServer.listenL(8080)

      _ <- taskLogger.info(s"Serving app at http://localhost:8080")

      shutdownTask = () => {
        logger.info("Shutting down server")
        produceServerMessages.cancel()
        vertx.close()
      }

      _ = sys.addShutdownHook(shutdownTask())

      _ <- Task.never.doOnCancel{
        Task.eval(shutdownTask())
      }

    } yield ExitCode.Success
  }
}
