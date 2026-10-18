// Command api runs the Between Us HTTP API.
package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"betweenus/api/internal/auth"
	"betweenus/api/internal/httpapi"
	"betweenus/api/internal/media"
	"betweenus/api/internal/pairing"
	"betweenus/db"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func run(log *slog.Logger) error {
	appEnv := env("APP_ENV", "development")
	prod := appEnv == "production"
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	pepper := os.Getenv("AUTH_PEPPER")
	if pepper == "" {
		if prod {
			return errors.New("AUTH_PEPPER is required in production")
		}
		pepper = "dev-only-pepper"
	}

	var provider auth.Provider
	switch env("OTP_PROVIDER", "dev") {
	case "dev":
		if prod {
			return errors.New("OTP_PROVIDER=dev is not allowed in production")
		}
		provider = auth.DevProvider{Log: log, FixedCode: os.Getenv("DEV_FIXED_OTP")}
	default:
		return errors.New("unknown OTP_PROVIDER")
	}

	if env("MIGRATE_ON_START", "true") == "true" {
		if err := migrate(dbURL); err != nil {
			return err
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	var blobs media.Blobs
	switch env("MEDIA_STORE", "fs") {
	case "fs":
		if prod {
			log.Warn("MEDIA_STORE=fs in production: photos live on this machine's disk")
		}
		blobs = media.FSBlobs{Root: env("MEDIA_DIR", ".devdb/media")}
	case "s3":
		b, err := media.NewS3Blobs(media.S3Config{
			Endpoint: os.Getenv("S3_ENDPOINT"), Region: os.Getenv("S3_REGION"), Bucket: os.Getenv("S3_BUCKET"),
			AccessKey: os.Getenv("S3_ACCESS_KEY"), SecretKey: os.Getenv("S3_SECRET_KEY"), UseSSL: env("S3_USE_SSL", "true") == "true",
		})
		if err != nil {
			return err
		}
		blobs = b
	default:
		return errors.New("unknown MEDIA_STORE")
	}

	srv := httpapi.New(httpapi.Config{
		Blobs:        blobs,
		AppOrigin:    env("APP_ORIGIN", "http://localhost:3000"),
		CookieSecure: prod,
		TrustProxy:   env("TRUST_PROXY", "false") == "true",
	}, log, pool, auth.NewService(pool, provider, []byte(pepper)), pairing.NewService(pool))

	httpSrv := &http.Server{
		Addr:              env("ADDR", ":8080"),
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdown)
	}()
	log.Info("listening", "addr", httpSrv.Addr, "env", appEnv)
	if err := httpSrv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func migrate(dbURL string) error {
	sqlDB, err := sql.Open("pgx", dbURL)
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	goose.SetBaseFS(db.Migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.Up(sqlDB, "migrations")
}
