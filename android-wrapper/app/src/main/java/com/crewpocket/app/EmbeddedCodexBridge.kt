package com.crewpocket.app

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future

class EmbeddedCodexBridge(private val context: Context) {
    companion object {
        const val PORT = 8766
        private const val TAG = "EmbeddedCodexBridge"
        private const val CODEX_LIBRARY = "libcodex_exec.so"

        fun binaryFile(context: Context): File {
            return File(context.applicationInfo.nativeLibraryDir, CODEX_LIBRARY)
        }

        fun isBinaryBundled(context: Context): Boolean {
            return Build.SUPPORTED_ABIS.contains("arm64-v8a") &&
                binaryFile(context).let { it.isFile && it.canRead() }
        }
    }

    private val workers: ExecutorService = Executors.newCachedThreadPool()
    @Volatile private var serverSocket: ServerSocket? = null
    @Volatile private var closed = false

    fun isRunning(): Boolean = serverSocket?.let { !it.isClosed } == true

    @Synchronized
    fun start(): Result<Unit> {
        if (isRunning()) return Result.success(Unit)
        if (!isBinaryBundled(context)) {
            return Result.failure(IllegalStateException("Embedded Codex binary is not bundled"))
        }

        return runCatching {
            closed = false
            val server = ServerSocket()
            server.reuseAddress = true
            server.bind(
                InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT),
                1
            )
            serverSocket = server
            workers.execute { acceptLoop(server) }
            Log.i(TAG, "Listening on 127.0.0.1:$PORT")
        }
    }

    @Synchronized
    fun stop() {
        closed = true
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
        workers.shutdownNow()
    }

    private fun acceptLoop(server: ServerSocket) {
        while (!closed && !server.isClosed) {
            try {
                val client = server.accept()
                workers.execute { handleClient(client) }
            } catch (error: Exception) {
                if (!closed) Log.e(TAG, "Accept failed", error)
            }
        }
    }

    private fun handleClient(client: Socket) {
        var process: Process? = null
        var upstream: Future<*>? = null
        var downstream: Future<*>? = null
        var stderr: Future<*>? = null

        try {
            client.tcpNoDelay = true
            process = startCodexProcess()

            upstream = workers.submit {
                try {
                    client.getInputStream().copyTo(process.outputStream)
                } finally {
                    try {
                        process.outputStream.close()
                    } catch (_: Exception) {
                    }
                }
            }

            downstream = workers.submit {
                process.inputStream.copyTo(client.getOutputStream())
                try {
                    client.getOutputStream().flush()
                } catch (_: Exception) {
                }
            }

            stderr = workers.submit {
                process.errorStream.bufferedReader().useLines { lines ->
                    lines.forEach { line -> Log.e(TAG, "codex: $line") }
                }
            }

            downstream.get()
        } catch (error: Exception) {
            Log.e(TAG, "Embedded Codex session failed", error)
        } finally {
            try {
                client.close()
            } catch (_: Exception) {
            }
            upstream?.cancel(true)
            downstream?.cancel(true)
            stderr?.cancel(true)
            process?.destroy()
            try {
                if (process?.isAlive == true) process.destroyForcibly()
            } catch (_: Exception) {
            }
        }
    }

    private fun startCodexProcess(): Process {
        val binary = binaryFile(context)
        val codexHome = File(context.filesDir, ".codex")
        codexHome.mkdirs()

        val builder = ProcessBuilder(
            binary.absolutePath,
            "app-server",
            "--listen",
            "stdio://"
        )
        builder.directory(context.filesDir)
        builder.redirectErrorStream(false)
        builder.environment().apply {
            put("HOME", context.filesDir.absolutePath)
            put("CODEX_HOME", codexHome.absolutePath)
            put("TMPDIR", context.cacheDir.absolutePath)
            put("CODEX_SELF_EXE", binary.absolutePath)
            put("LD_LIBRARY_PATH", context.applicationInfo.nativeLibraryDir)
        }
        return builder.start()
    }
}
