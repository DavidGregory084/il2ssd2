val verticesVersion = "0.1.2"
val monixVersion = "3.1.0"

libraryDependencies ++= Seq(
  // Async programming
  "io.monix" %% "monix-eval" % monixVersion,
  "io.monix" %% "monix-reactive" % monixVersion,
  // Integrates Monix with Vert.x
  "io.github.davidgregory084" %% "vertices-core" % verticesVersion,
  "io.github.davidgregory084" %% "vertices-web" % verticesVersion,
  // JSON
  "io.circe" %% "circe-parser" % "0.13.0",
  "io.circe" %% "circe-derivation" % "0.13.0-M4",
  // Unescaping functions for Strings
  "org.apache.commons" % "commons-text" % "1.8",
  // Logging
  "io.chrisdavenport" %% "log4cats-slf4j" % "1.0.1",
  "org.apache.logging.log4j" % "log4j-core" % "2.13.1",
  "org.apache.logging.log4j" % "log4j-slf4j-impl" % "2.13.1",
  "com.typesafe.scala-logging" %% "scala-logging" % "3.9.2",
  // Configuration
  "com.typesafe" % "config" % "1.4.0",
)

scalaVersion := "2.13.1"

scalacOptions ~= { opts => opts.filterNot(Set("-Wdead-code", "-Wvalue-discard", "-Wunused:params")) }

run / connectInput := true

val installNpm = taskKey[Unit]("Install NPM packages in the Javascript project")
installNpm / fileInputs += baseDirectory.value.toGlob / ".." / "app" / "package.json"

installNpm := {
  import scala.sys.process.Process
  val log = streams.value.log
  val appDir = file("../app")
  if (installNpm.inputFileChanges.hasChanges) {
    Process("npm" :: "install" :: Nil, appDir) ! log
  }
}

val buildJavaScript = taskKey[Seq[File]]("Build Javascript project into optimised output with source maps")
buildJavaScript / fileInputs += baseDirectory.value.toGlob / ".." / "app" / "index.js"
buildJavaScript / fileInputs += baseDirectory.value.toGlob / ".." / "app" / "index.html"
buildJavaScript / fileInputs += baseDirectory.value.toGlob / ".." / "app" / "src" / ** / "*.css"
buildJavaScript / fileInputs += baseDirectory.value.toGlob / ".." / "app" / "src" / ** / "*.js"
buildJavaScript / fileInputs += baseDirectory.value.toGlob / ".." / "app" / "src" / ** / "*.css"
buildJavaScript / fileInputs += baseDirectory.value.toGlob / ".." / "app" / "src" / ** / "*.html"

buildJavaScript := {
  import scala.sys.process.Process

  val log = streams.value.log
  val resourceDir = (Compile / resourceManaged).value / "webroot"
  val appDir = file("../app")
  val distDir = appDir / "dist"

  // Install NPM packages
  installNpm.value

  if (buildJavaScript.inputFileChanges.hasChanges) {
    // Delete previously bundled files
    IO.delete(IO.listFiles(distDir))
    IO.delete(IO.listFiles(resourceDir))

    // Run Parcel bundler
    Process("npx" :: "parcel" :: "build" :: "index.html" :: Nil, appDir) ! log

    // Copy the results to webroot
    IO.copyDirectory(distDir, resourceDir, overwrite = true)
  }

  IO.listFiles(resourceDir).toSeq
}

Compile / resourceGenerators += buildJavaScript

assemblyMergeStrategy in assembly := {
  case "META-INF/io.netty.versions.properties" =>
    MergeStrategy.concat
  case other =>
    (assemblyMergeStrategy in assembly).value(other)
}
