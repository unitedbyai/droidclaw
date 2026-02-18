export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  PORT: parseInt(process.env.PORT || "8080"),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",
  INTERNAL_SECRET: process.env.INTERNAL_SECRET || "",
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
