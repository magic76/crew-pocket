package com.crewpocket.runtime

import android.content.Context
import android.util.Base64
import java.io.File
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import java.security.KeyStore
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/** Exposes Android's trusted roots to native clients that expect a PEM file. */
object EmbeddedTrustStore {
    @Synchronized
    fun javaTrustStore(context: Context): File {
        val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        factory.init(null as KeyStore?)
        val certificates = factory.trustManagers.filterIsInstance<X509TrustManager>().flatMap { it.acceptedIssuers.toList() }
        check(certificates.isNotEmpty()) { "Android trust store has no CA certificates" }
        val directory = File(context.filesDir, ".crew-pocket").apply { mkdirs() }
        val output = File(directory, "java-truststore.jks")
        // Android PKCS12 omits OpenJDK's trusted-cert attributes; OpenJDK reads
        // that file as an empty store. Serialize trusted certificate JKS entries.
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { data ->
            data.writeInt(0xFEEDFEED.toInt())
            data.writeInt(2)
            data.writeInt(certificates.size)
            certificates.forEachIndexed { index, certificate ->
                data.writeInt(2)
                data.writeUTF("android-$index")
                data.writeLong(System.currentTimeMillis())
                data.writeUTF("X.509")
                data.writeInt(certificate.encoded.size)
                data.write(certificate.encoded)
            }
        }
        val content = bytes.toByteArray()
        val digest = MessageDigest.getInstance("SHA-1")
        digest.update("changeit".toByteArray(Charsets.UTF_16BE))
        digest.update("Mighty Aphrodite".toByteArray(Charsets.UTF_8))
        digest.update(content)
        val temporary = File(directory, "java-truststore.jks.tmp")
        temporary.writeBytes(content + digest.digest())
        check(temporary.renameTo(output)) { "Cannot publish Java trust store" }
        return output
    }
    @Synchronized
    fun certificateBundle(context: Context): File {
        val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        factory.init(null as KeyStore?)
        val certificates = factory.trustManagers.filterIsInstance<X509TrustManager>()
            .flatMap { it.acceptedIssuers.toList() }
        check(certificates.isNotEmpty()) { "Android trust store has no CA certificates" }

        val directory = File(context.filesDir, ".crew-pocket").apply { mkdirs() }
        val bundle = File(directory, "ca-certificates.pem")
        val pem = certificates.joinToString("") { certificate ->
            val encoded = Base64.encodeToString(certificate.encoded, Base64.NO_WRAP)
            "-----BEGIN CERTIFICATE-----\n" +
                encoded.chunked(64).joinToString("\n") +
                "\n-----END CERTIFICATE-----\n"
        }
        if (!bundle.isFile || bundle.readText() != pem) {
            val temporary = File(directory, "ca-certificates.pem.tmp")
            temporary.writeText(pem)
            check(temporary.renameTo(bundle)) { "Cannot publish Android CA bundle" }
        }
        return bundle
    }
}
