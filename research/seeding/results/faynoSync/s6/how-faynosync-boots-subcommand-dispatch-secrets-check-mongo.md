---
id: how-faynosync-boots-subcommand-dispatch-secrets-check-mongo
type: flow
title: "how faynoSync boots: subcommand dispatch, secrets check, Mongo, Redis, then routes"
anchors:
  - {"path":"faynoSync.go","hash":"sha256:8860566197bd","head":"ca2f88a4fe38"}
  - {"path":"server/server.go","hash":"sha256:3b12835acabb","head":"ca2f88a4fe38"}
  - {"path":"mongod/adapter.go","hash":"sha256:9f83418c9640","head":"ca2f88a4fe38"}
  - {"path":"redisdb/redis.go","hash":"sha256:aaa45451e1d0","head":"ca2f88a4fe38"}
  - {"path":"server/healthcheck.go","hash":"sha256:65c99202bb69","head":"ca2f88a4fe38"}
  - {"path":"server/handler/info/info.go","hash":"sha256:b5e6e149c3e9","head":"ca2f88a4fe38"}
  - {"path":"server/server_test.go","hash":"sha256:df938ddbf267","head":"ca2f88a4fe38"}
status: active
updated: 2026-11-17T03:28:54.337Z
edits: 1
---

# how faynoSync boots: subcommand dispatch, secrets check, Mongo, Redis, then routes

Only server mode (no args) runs validateSecrets, and it runs before any database connection; Mongo is connected before Redis, and Redis is required even when TUF_ENABLED and REPORTS_ENABLED are off (a failed ping calls os.Exit(1)). The healthcheck and migrate subcommands skip all of that. Config is viper reading .env from the working directory (missing file is only logged) plus AutomaticEnv.

## Steps

1. `faynoSync.go` (`main`) — flag.Parse runs first, then the first positional arg picks the mode: none = StartServer, healthcheck, migrate up|down; anything else exits 1. A --loglevel flag must precede the subcommand
2. `server/server.go` (`StartServer`, `validateSecrets`) — validateSecrets, then Mongo, then Redis, then route registration, then the optional TUF bumper
3. `mongod/adapter.go` (`ConnectToDatabase`) — bad MONGODB_URL panics; connect/ping failure is logrus.Fatal; shared by server and migrate modes
4. `redisdb/redis.go` (`ConnectToRedis`) — package-level singleton: a second call returns the first client and ignores its config
5. `server/healthcheck.go` (`Healthcheck`) — healthcheck subcommand GETs 127.0.0.1:PORT/health and passes only on 200; used as the Docker HEALTHCHECK because the image has no curl
6. `server/handler/info/info.go` (`HealthCheck`) — /health pings Mongo then Redis and returns 424 on failure

## Invariants

- validateSecrets is not called on the healthcheck or migrate paths
- Redis is connected in every server start
- An empty API_KEY is valid at boot (only /signup is not registered); server_test.go TestValidateSecrets pins this
