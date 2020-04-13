val verticesVersion = "0.1.2"
val monixVersion = "3.1.0"

libraryDependencies ++= Seq(
  "io.github.davidgregory084" %% "vertices-core" % verticesVersion,
  "io.github.davidgregory084" %% "vertices-web" % verticesVersion,
  "io.monix" %% "monix-eval" % monixVersion,
  "io.monix" %% "monix-reactive" % monixVersion,
  "io.circe" %% "circe-parser" % "0.13.0",
  "io.circe" %% "circe-derivation" % "0.13.0-M4",
  "org.apache.commons" % "commons-text" % "1.8",
)

scalaVersion := "2.13.1"

Compile / resourceGenerators += Def.task {
  import scala.sys.process.Process
  val log = streams.value.log
  val resourceDir = (Compile / resourceManaged).value / "webroot"
  Process("npm" :: "install" :: Nil, file("../app")) ! log
  Process("npx" :: "parcel" :: "build" :: "index.html" :: Nil, file("../app")) ! log
  IO.copyDirectory(file("../app/dist"), resourceDir, overwrite = true)
  IO.listFiles(resourceDir).toSeq
}.taskValue