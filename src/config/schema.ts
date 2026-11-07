export interface DatabaseConfig {
    Host: string;
    Port: number;
    User: string;
    Password: string;
    Name: string;
}

export interface Config {
    Database: DatabaseConfig;
}
