import { config } from "../config/config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
    debug: (message: string, fields?: LogFields) => void;
    info: (message: string, fields?: LogFields) => void;
    warn: (message: string, fields?: LogFields) => void;
    error: (message: string, fields?: LogFields) => void;
}

// Key-based redaction: anything that looks like a credential never reaches
// stdout, even if a caller passes a whole config or request object by mistake.
const SENSITIVE_KEY = /token|secret|password|authorization|credential|cookie|api[-_]?key/i;
const REDACTED = "[redacted]";
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;

const normalize = (value: unknown, depth: number): unknown => {
    if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
    }
    if (value instanceof Date) return value.toISOString();
    if (value === null || typeof value !== "object") return value;
    // Also breaks cycles: a self-referencing object stops at the depth cap.
    if (depth >= MAX_DEPTH) return "[depth limit reached]";

    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_ITEMS).map((item) => normalize(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        result[key] = SENSITIVE_KEY.test(key) ? REDACTED : normalize(entry, depth + 1);
    }
    return result;
};

const normalizeFields = (fields: LogFields | undefined): LogFields => {
    if (fields === undefined) return {};

    const result: LogFields = {};
    for (const [key, value] of Object.entries(fields)) {
        result[key] = SENSITIVE_KEY.test(key) ? REDACTED : normalize(value, 0);
    }
    return result;
};

export interface LoggerOptions {
    /** Minimum level to emit. Defaults to LOG_LEVEL from the validated config. */
    level?: LogLevel;
}

/**
 * Creates a logger that writes one JSON object per line to stdout/stderr.
 * Deliberately console-based so process-level redirection and test spies work.
 */
export const createLogger = (options: LoggerOptions = {}): Logger => {
    const threshold = LEVEL_ORDER[options.level ?? config.Log.Level];

    const write = (level: LogLevel, message: string, fields?: LogFields): void => {
        if (LEVEL_ORDER[level] < threshold) return;

        let line: string;
        try {
            line = JSON.stringify({
                // Envelope last so caller fields can never forge time/level/msg.
                ...normalizeFields(fields),
                time: new Date().toISOString(),
                level,
                msg: message,
            });
        } catch {
            // A logger must never take the process down (bigint, cyclic toJSON...).
            line = JSON.stringify({
                time: new Date().toISOString(),
                level,
                msg: message,
                logError: "fields were not serializable",
            });
        }

        if (level === "error") console.error(line);
        else if (level === "warn") console.warn(line);
        else console.log(line);
    };

    return {
        debug: (message, fields) => write("debug", message, fields),
        info: (message, fields) => write("info", message, fields),
        warn: (message, fields) => write("warn", message, fields),
        error: (message, fields) => write("error", message, fields),
    };
};

/** The app-wide logger, level fixed from config at boot. */
export const logger = createLogger();
