package com.crewpocket.runtime

import android.content.Context
import android.util.Base64
import java.io.File
import java.security.KeyStore
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/** Exposes Android's trusted roots to native clients that expect a PEM file. */
object EmbeddedTrustStore {
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
