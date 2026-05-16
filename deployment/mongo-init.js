// Lydomania — Mongo init script.
// Creates a non-root application user scoped to the DB name from .env so
// the backend doesn't run as the root admin.  Idempotent: safe to re-run.

const dbName = process.env.MONGO_INITDB_DATABASE || "lydomania";

db = db.getSiblingDB(dbName);
db.createCollection("users");
db.createCollection("deposits");
db.createCollection("cases");
db.createCollection("items");

print("Lydomania mongo-init.js: created collections in db=" + dbName);
