package il2ssd

import cats.effect._
import cats.kernel.instances.string._
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
import scala.concurrent.duration._
import vertices._
import vertices.core._

object Server extends TaskApp {
  val logger = Logger[Server.type]
  val taskLogger = Slf4jLogger.getLogger[Task]

  val exceptionHandler: Handler[Throwable] = t => logger.error("Uncaught exception", t)
  val uncaughtExceptionReporter = UncaughtExceptionReporter(exceptionHandler.handle)
  val IOScheduler = Scheduler.io("il2ssd-io", reporter = uncaughtExceptionReporter)

  val vertx = Vertx.vertx.exceptionHandler(exceptionHandler)
  val netClient = vertx.createNetClient(new NetClientOptions().setTcpKeepAlive(true))

  val TypeField = Some("type")

  sealed abstract class ServerMessage extends Product with Serializable
  case class ConsoleMessage(message: String) extends ServerMessage
  case class PilotJoinMessage(socket: Int, ip: String, port: Int, name: String) extends ServerMessage
  case class PilotLeaveMessage(socket: Int, ip: String, port: Int) extends ServerMessage
  case class HostMessage(socket: Int, ip: String, port: Int, name: String, number: Int) extends ServerMessage
  case class UserMessage(number: Int, name: String, ping: Int, score: Int, army: String, aircraft: Option[String]) extends ServerMessage
  case class MissionPlayingMessage(mission: String) extends ServerMessage
  case class MissionLoadedMessage(mission: String) extends ServerMessage
  case class MissionNotLoadedMessage() extends ServerMessage
  case class NameBanMessage(name: String) extends ServerMessage
  case class IPBanMessage(ip: String) extends ServerMessage
  case class DifficultyMessage(setting: String, enabled: Boolean) extends ServerMessage
  object ServerMessage {
    implicit val codec: Codec.AsObject[ServerMessage] = deriveCodec(identity, false, TypeField)
    implicit val consoleCodec: Codec.AsObject[ConsoleMessage] = deriveCodec(identity, false, TypeField)
    implicit val pilotJoinCodec: Codec.AsObject[PilotJoinMessage] = deriveCodec(identity, false, TypeField)
    implicit val pilotLeaveCodec: Codec.AsObject[PilotLeaveMessage] = deriveCodec(identity, false, TypeField)
    implicit val hostCodec: Codec.AsObject[HostMessage] = deriveCodec(identity, false, TypeField)
    implicit val userCodec: Codec.AsObject[UserMessage] = deriveCodec(identity, false, TypeField)
    implicit val missionPlayingCodec: Codec.AsObject[MissionPlayingMessage] = deriveCodec(identity, false, TypeField)
    implicit val missionLoadedCodec: Codec.AsObject[MissionLoadedMessage] = deriveCodec(identity, false, TypeField)
    implicit val missionNotLoadedCodec: Codec.AsObject[MissionNotLoadedMessage] = deriveCodec(identity, false, TypeField)
    implicit val nameBanCodec: Codec.AsObject[NameBanMessage] = deriveCodec(identity, false, TypeField)
    implicit val ipBanCodec: Codec.AsObject[IPBanMessage] = deriveCodec(identity, false, TypeField)
    implicit val difficultyCodec: Codec.AsObject[DifficultyMessage] = deriveCodec(identity, false, TypeField)
    def console(message: String): ServerMessage =
      ConsoleMessage(message)
    def pilotJoin(socket: Int, ip: String, port: Int, name: String): ServerMessage =
      PilotJoinMessage(socket, ip, port, name)
    def pilotLeave(socket: Int, ip: String, port: Int): ServerMessage =
      PilotLeaveMessage(socket, ip, port)
    def host(socket: Int, ip: String, port: Int, name: String, number: Int) =
      HostMessage(socket, ip, port, name, number)
    def user(number: Int, name: String, ping: Int, score: Int, army: String, aircraft: Option[String]) =
      UserMessage(number, name, ping, score, army, aircraft)
    def missionPlaying(mission: String): ServerMessage =
      MissionPlayingMessage(mission)
    def missionLoaded(mission: String): ServerMessage =
      MissionLoadedMessage(mission)
    val missionNotLoaded: ServerMessage =
      MissionNotLoadedMessage()
    def nameBan(name: String): ServerMessage =
      NameBanMessage(name)
    def ipBan(ip: String): ServerMessage =
      IPBanMessage(ip)
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

  def handleClientMessage(uiSocket: ServerWebSocket, il2ServerSocket: NetSocket, commandObserver: Observer[ConsoleCommand]): Handler[String] = { message: String =>
    val decoded = decode[ClientMessage](message)

    decoded.foreach {
      case msg @ ConsoleCommand(command) =>
        logger.info(s"Received client message: ${msg}")
        commandObserver.onNext(msg)
        il2ServerSocket.write(command + "\n")
      case _ =>
    }

    decoded.swap.foreach {
      case parsing: ParsingFailure =>
        logger.error(s"Failed decoding client message ${message}", parsing)
      case decoding: DecodingFailure =>
        logger.error(s"Failed parsing client message ${message}", decoding)
    }
  }

  def unescapedLines(il2ServerLines: Observable[String]): Observable[String] = {
    il2ServerLines.map { messageText =>
      val sanitisedText = StringEscapeUtils.unescapeJava(messageText)
      val promptSymbol = Matcher.quoteReplacement("$")
      val withPrompt = sanitisedText.replaceAll("""<consoleN><\d+>""", promptSymbol)
      val trimmedNewline = withPrompt.replaceFirst("""\n$""", "")
      trimmedNewline
    }
  }

  def pilotMessages(il2ServerLines: Observable[String]): Observable[ServerMessage] = {
    val MatchPilotJoinMessage = """socket channel '(\d+)', ip (\d+{1,3}(?:\.\d{1,3}){3}):(\d+), (\S+), is complete created""".r
    val MatchPilotLeaveMessage = """socketConnection with (\d+{1,3}(?:\.\d{1,3}){3}):(\d+) on channel (\d+) lost\.  Reason:.*""".r
    val MatchHostMessage = """\u0020(\d+): (\S+) \[(\d+)\](\d+{1,3}(?:\.\d{1,3}){3}):(\d+)""".r
    val MatchUserMessage = """\u0020(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+\(\d+\)(\S+)\s+(.+)?""".r
    il2ServerLines.collect {
      case MatchPilotJoinMessage(socket, ip, port, name) =>
        ServerMessage.pilotJoin(socket.toInt, ip, port.toInt, name)
      case MatchPilotLeaveMessage(ip, port, socket) =>
        ServerMessage.pilotLeave(socket.toInt, ip, port.toInt)
      case MatchHostMessage(number, name, socket, ip, port) =>
        ServerMessage.host(socket.toInt, ip, port.toInt, name, number.toInt)
      case MatchUserMessage(number, name, ping, score, army, aircraft) =>
        ServerMessage.user(number.toInt, name, ping.toInt, score.toInt, army, Option(aircraft))
    }
  }

  def missionMessages(il2ServerLines: Observable[String]): Observable[ServerMessage] = {
    val MatchMissionPlayingMessage = """Mission: (.+\.mis) is Playing""".r
    val MatchMissionLoadedMessage = """Mission: (.+\.mis) is Loaded""".r
    val MatchMissionNotLoadedMessage = """Mission NOT loaded""".r
    il2ServerLines.collect {
      case MatchMissionPlayingMessage(mission) =>
        ServerMessage.missionPlaying(mission)
      case MatchMissionLoadedMessage(mission) =>
        ServerMessage.missionLoaded(mission)
      case MatchMissionNotLoadedMessage() =>
        ServerMessage.missionNotLoaded
    }
  }

  def banMessage(il2ServerLine: String): Observable[ServerMessage] = {
    val MatchIPBanMessage = """\u0020 (\d+{1,3}(?:\.\d{1,3}){3})""".r
    val MatchNameBanMessage = """\u0020 (\S+)""".r
    il2ServerLine match {
      case MatchIPBanMessage(ip) =>
        Observable(ServerMessage.ipBan(ip))
      case MatchNameBanMessage(name) =>
        Observable(ServerMessage.nameBan(name))
      case _ =>
        Observable.empty
    }
  }

  def difficultyMessage(il2ServerLine: String): Observable[ServerMessage] = {
    val MatchDifficultyMessage = """\u0020 ([A-Za-z0-9_]+)\s*(0|1)""".r
    il2ServerLine match {
      case MatchDifficultyMessage(setting, "0") =>
        Observable(ServerMessage.difficulty(setting, false))
      case MatchDifficultyMessage(setting, "1") =>
        Observable(ServerMessage.difficulty(setting, true))
      case _ =>
        Observable.empty
    }
  }

  def serverMessages(il2ServerData: Observable[Buffer], commandStream: Observable[ConsoleCommand]): Observable[ServerMessage] = {
    val il2ServerLines = unescapedLines(bufferLines(il2ServerData))

    val lastCommand = commandStream
      .filter(cmd => cmd.command == "difficulty" || cmd.command == "ban")
      .distinctUntilChangedByKey(_.command)

    Observable(
      il2ServerLines.map(ServerMessage.console),
      pilotMessages(il2ServerLines),
      missionMessages(il2ServerLines),
      il2ServerLines.withLatestFrom(lastCommand) {
        case (line, ConsoleCommand("ban")) =>
          banMessage(line)
        case (line, ConsoleCommand("difficulty")) =>
          difficultyMessage(line)
        case _ =>
          Observable.empty
      }.flatten
    ).merge
  }

  def handleWebsocketConnection(il2ServerSocket: NetSocket, il2ServerMessages: Observable[ServerMessage], commandObserver: Observer[ConsoleCommand]): Handler[ServerWebSocket] = { uiSocket: ServerWebSocket =>
    val sendServerMessages = il2ServerMessages
      .map(_.asJson.noSpaces)
      .mapEval(uiSocket.writeTextMessageL)
      .runAsyncGetLast(IOScheduler)

    uiSocket.endHandler(_ => sendServerMessages.cancel())
    uiSocket.closeHandler(_ => sendServerMessages.cancel())
    uiSocket.textMessageHandler(handleClientMessage(uiSocket, il2ServerSocket, commandObserver))
  }

  def handleServerMessage(il2ServerSocket: NetSocket, msg: ServerMessage): Task[Unit] = msg match {
    case joined: PilotJoinMessage =>
      il2ServerSocket.writeL(s"host ${joined.name}\n")
    case _ =>
      Task.unit
  }

  def run(args: List[String]): Task[ExitCode] = {
    val staticHandler = StaticHandler.create()
      .setCachingEnabled(false)
      .setIncludeHidden(false)

    val router = Router.router(vertx)
    router.route().handler(staticHandler)

    val httpServer = vertx.createHttpServer
    httpServer.requestHandler(router.handle)

    val (commandObserver, commandStream) = Pipe
      .behavior[ConsoleCommand](ConsoleCommand("server"))
      .multicast(IOScheduler)

    for {
      il2ServerSocket <- netClient.connectL(args(1).toInt, args(0))

      _ <- taskLogger.info(s"Connected to ${args(0)}:${args(1)}")

      il2ServerStream <- il2ServerSocket.toObservable(vertx)

      il2ServerMessages = serverMessages(il2ServerStream, commandStream)
        .doOnNext(msg => taskLogger.info(s"Sending server message: ${msg}"))
        .doOnNext(msg => handleServerMessage(il2ServerSocket, msg))
        .publish(IOScheduler)

      produceServerMessages = il2ServerMessages.connect()

      refreshServerData = Observable.intervalAtFixedRate(10.seconds, 10.seconds)
        .doOnNext(_ => il2ServerSocket.writeL("user\n"))
        .runAsyncGetLast(IOScheduler)

      _ = httpServer.webSocketHandler(handleWebsocketConnection(il2ServerSocket, il2ServerMessages, commandObserver))

      _ <- httpServer.listenL(8080)

      _ <- taskLogger.info(s"Serving app at http://localhost:8080")

      shutdownTask = () => {
        logger.info("Shutting down server")
        produceServerMessages.cancel()
        refreshServerData.cancel()
        vertx.close()
      }

      _ = sys.addShutdownHook(shutdownTask())

      _ <- Task.never.doOnCancel{
        Task.eval(shutdownTask())
      }

    } yield ExitCode.Success
  }
}
