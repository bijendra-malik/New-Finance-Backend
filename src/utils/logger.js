const winston = require("winston");

/*
==========================================
Professional Logger for Indexia Finance Backend

USAGE:
  const logger = require("./utils/logger");
  
  logger.info("Server started");           // Normal info
  logger.error("Database failed", error);  // Errors
  logger.warn("Rate limit hit");           // Warnings
  logger.debug("User data:", data);        // Debugging

WHY USE THIS:
  ✅ Logs saved to files (logs/error.log, logs/combined.log)
  ✅ Different log levels (info, error, warn, debug)
  ✅ Timestamp automatically added
  ✅ Production ready
==========================================
*/

// Log format: timestamp + level + message
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info", // info, warn, error, debug
  format: logFormat,
  transports: [
    // Error logs (only errors)
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
    }),
    
    // Combined logs (everything)
    new winston.transports.File({
      filename: "logs/combined.log",
    }),
  ],
});

// Development mein console par bhi dikhao
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message }) => {
          return `${level}: ${message}`;
        })
      ),
    })
  );
}

module.exports = logger;
