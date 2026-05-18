package com.example.svc;

import org.example.third_party.Logger;

public class ShadowedClient {

    private final Logger log;

    public ShadowedClient(Logger log) {
        this.log = log;
    }

    public void run() {
        log.info("hello");
    }
}
