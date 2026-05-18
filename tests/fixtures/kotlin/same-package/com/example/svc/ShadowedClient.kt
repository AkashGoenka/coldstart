package com.example.svc

import org.example.third_party.Logger

class ShadowedClient(private val log: Logger) {
    fun run() {
        log.info("hello")
    }
}
