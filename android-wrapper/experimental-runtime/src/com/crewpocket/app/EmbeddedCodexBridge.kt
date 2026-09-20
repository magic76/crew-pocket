package com.crewpocket.app

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future

class EmbeddedCodexBridge(private val context: Context, private val bridgeToken: String) {
    companion object {
        // 8766 belongs to Crew Helper's private bridge. Keep Crew Pocket isolated.
        const val PORT = 8767
        private const val TAG = "EmbeddedCodexBridge"
        private const val CODEX_LIBRARY = "libcodex_exec.so"
        private const val HANDSHAKE_PREFIX = "CREW-CODEX-BRIDGE/1 "

        fun generateToken(): String {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }

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
            client.soTimeout = 2_000
            if (!authenticate(client)) {
                Log.w(TAG, "Rejected unauthenticated bridge client")
                return
            }
            client.soTimeout = 0

            val codex = startCodexProcess()
            process = codex

            upstream = workers.submit {
                try {
                    client.getInputStream().copyTo(codex.outputStream)
                } finally {
                    try {
                        codex.outputStream.close()
                    } catch (_: Exception) {
                    }
                }
            }

            downstream = workers.submit {
                codex.inputStream.copyTo(client.getOutputStream())
                try {
                    client.getOutputStream().flush()
                } catch (_: Exception) {
                }
            }

            stderr = workers.submit {
                codex.errorStream.bufferedReader().useLines { lines ->
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


    private fun authenticate(client: Socket): Boolean {
        val input = client.getInputStream()
        val line = ByteArray(256)
        var size = 0

        while (size < line.size) {
            val value = input.read()
            if (value < 0) return false
            if (value == '\n'.code) break
            line[size++] = value.toByte()
        }

        if (size == line.size) return false
        val expected = (HANDSHAKE_PREFIX + bridgeToken).toByteArray(Charsets.UTF_8)
        val actual = line.copyOf(size)
        val valid = MessageDigest.isEqual(expected, actual)
        if (valid) {
            client.getOutputStream().write("OK\n".toByteArray(Charsets.UTF_8))
            client.getOutputStream().flush()
        }
        return valid
    }

    private fun ensureCodexConfig(codexHome: File) {
        val config = File(codexHome, "config.toml")
        val existing = if (config.isFile) config.readText() else ""
        if (Regex("(?m)^\\s*cli_auth_credentials_store\\s*=").containsMatchIn(existing)) {
            return
        }

        val prefix = if (existing.isBlank() || existing.endsWith("\n")) "" else "\n"
        config.appendText(
            prefix +
                "# Managed by Crew Pocket Android wrapper\n" +
                "cli_auth_credentials_store = \"file\"\n"
        )
    }

    private fun startCodexProcess(): Process {
        val binary = binaryFile(context)
        val codexHome = File(context.filesDir, ".codex")
        codexHome.mkdirs()
        ensureCodexConfig(codexHome)

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
            put("SHELL", "/system/bin/sh")
            if (get("PATH").isNullOrBlank()) {
                put("PATH", "/system/bin:/system/xbin:/product/bin")
            }
            put("CODEX_SELF_EXE", binary.absolutePath)
            put("LD_LIBRARY_PATH", context.applicationInfo.nativeLibraryDir)
        }
        return builder.start()
    }
}
