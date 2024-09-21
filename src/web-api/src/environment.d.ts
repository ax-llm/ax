declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly APACHE_TIKA_URL: string;
      readonly APP_SECRET: string;
      readonly DATA_SECRET: string;
      readonly GOOGLE_ID?: string;
      readonly GOOGLE_SECRET?: string;
      readonly MONGO_URI: string;
      readonly NO_AUTH: 'false' | 'true';
      readonly NODE_ENV: 'development' | 'production';
      readonly PORT: number;
      readonly PUBLIC_URL: string;
    }
  }
}

export {};
