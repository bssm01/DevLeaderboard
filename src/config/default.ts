const defaults: Record<string, string | number> = {
    DATABASE_HOST: "localhost",
    DATABASE_PORT: 5432,
    DATABASE_USER: "postgres",
    DATABASE_PASSWORD: "postgres",
    DATABASE_NAME: "devleaderboard",
};

function setDefault(key: string, value: string | number): void {
    if (process.env[key] === undefined) {
        console.log(`Config: '${key}' not set, using default: ${value}`);
        process.env[key] = String(value);
    }
}

export function applyDefaults(): void {
    for (const [key, value] of Object.entries(defaults)) {
        setDefault(key, value);
    }
}
