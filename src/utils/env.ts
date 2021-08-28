import { join } from "path";

const { env } = process;

export const username = env.AH_USERNAME;
export const password = env.AH_PASSWORD;

export const storePath = env.STORE_PATH ?? join(process.cwd(), "store.json");

export const timesheetCacheDuration = env.TIMESHEET_CACHE
	? +env.TIMESHEET_CACHE
	: 3600;
