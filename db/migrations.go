// Package db embeds the SQL migrations so the API and tests apply the same schema.
package db

import "embed"

//go:embed migrations/*.sql
var Migrations embed.FS
