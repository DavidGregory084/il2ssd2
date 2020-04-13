package il2ssd

import cats.effect._
import cats.implicits._
import io.circe._
import io.circe.Codec
import io.circe.derivation._
import io.circe.parser.decode
import io.circe.syntax._
import io.vertx.core._
import io.vertx.core.buffer.Buffer
import io.vertx.core.http.ServerWebSocket
import io.vertx.core.net.{ NetClientOptions, NetSocket }
import java.io. { BufferedReader, InputStreamReader, PipedInputStream, PipedOutputStream }
import java.nio.charset.StandardCharsets
import java.util.regex.Matcher
import monix.execution.Scheduler
import monix.execution.schedulers.CanBlock
import monix.eval._
import monix.reactive._
import org.apache.commons.text.StringEscapeUtils
import scala.concurrent.duration._
import vertices._
import vertices.core._

object Server extends TaskApp {
  sealed abstract class ServerMessage extends Product with Serializable
  case class ConsoleMessage(message: String) extends ServerMessage
  object ServerMessage {
    implicit val codec: Codec.AsObject[ServerMessage] = deriveCodec
    implicit val consoleCodec: Codec.AsObject[ConsoleMessage] = deriveCodec
    def console(message: String): ServerMessage = ConsoleMessage(message)
  }
  
  sealed abstract class ClientMessage extends Product with Serializable
  case class ConsoleCommand(command: String) extends ClientMessage
  object ClientMessage {
    implicit val codec: Codec.AsObject[ClientMessage] = deriveCodec
    implicit val consoleCodec: Codec.AsObject[ConsoleCommand] = deriveCodec
  }
  
  def bufferLines(dataBuffers: Observable[Buffer]): Observable[String] = {
    dataBuffers.mapAccumulate("") {
      case (currentLine, buffer) =>
      val bufferText = buffer.toString()
      val lineEnding = """(?=[\r\n])\r?\n?"""
      val bufferLines = bufferText.split(lineEnding, -1).toList
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
  
  def formatLine(messageText: String): ServerMessage = {
    val sanitisedText = StringEscapeUtils.unescapeJava(messageText)
    val promptSymbol = Matcher.quoteReplacement("$\n")
    val withPrompt = sanitisedText.replaceAll("""<consoleN><\d+>""", promptSymbol)
    ServerMessage.console(withPrompt)
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
  
  def handleWebsocketConnection(il2ServerSocket: NetSocket, il2ServerData: Observable[Buffer]): Handler[ServerWebSocket] = { uiSocket: ServerWebSocket =>
    val sendConsoleMessages =
      bufferLines(il2ServerData)
        .map(formatLine)
        .map(_.asJson.noSpaces)
        .mapEval(uiSocket.writeTextMessageL)
        .lastL.runAsync(Scheduler.global)
    
    uiSocket.textMessageHandler(handleClientMessage(uiSocket, il2ServerSocket))
    
    uiSocket.endHandler(_ => sendConsoleMessages.cancel())
  }
  
  def run(args: List[String]): Task[ExitCode] = {
    val vertx = Vertx.vertx
    val netClient = vertx.createNetClient(new NetClientOptions().setTcpKeepAlive(true))
    val httpServer = vertx.createHttpServer
    
    for {
      il2ServerSocket <- netClient.connectL(20000, args(0))
      
      il2ServerStream <- il2ServerSocket.toObservable(vertx)
      
      il2ServerData = il2ServerStream.publish(Scheduler.global)
      
      readIl2ServerMessages = il2ServerData.connect()
      
      _ = httpServer.webSocketHandler(handleWebsocketConnection(il2ServerSocket, il2ServerData))
      
      _ <- httpServer.listenL(8080)
      
      _ <- Task.never.doOnCancel(Task.eval {
        readIl2ServerMessages.cancel()
      })
      
    } yield ExitCode.Success
  }
}