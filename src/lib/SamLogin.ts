import axios, { AxiosInstance, AxiosResponse } from "axios";
import colors from "chalk";
import cheerio from "cheerio";

import Store from "@lib/store";

import Schema, { Month, Shift } from "@models/store";

const timesheetURL = "wrkbrn_jct/etm/time/timesheet/etmTnsMonth.jsp";

const EXPIRY = 60 * 60 * 1000;
const CACHE_EXPIRY = 60 * 60 * 1000;

export default class SamLogin {
	private db: Store<Schema>;
	private http: AxiosInstance;

	private username: string;
	private password: string;

	private busy = false;

	private getToken = (): string | undefined => this.db.data.token;

	private isLoggedIn = (): boolean => Date.now() > (this.db.data.expiry ?? 0);

	private updateExpiry = async (): Promise<void> => {
		this.db.data.expiry = Date.now() + EXPIRY;
		await this.db.write();
	};

	private updateToken = async (token: string): Promise<void> => {
		this.db.data.token = token;
		this.db.data.created = new Date().toLocaleString();
		await this.updateExpiry();
	};

	constructor({
		username,
		password,
		store
	}: {
		username: string;
		password: string;
		store: Store<Schema>;
	}) {
		this.http = axios.create({
			baseURL: "https://sam.ahold.com/",
			timeout: 5000
		});

		this.http.interceptors.request.use((c) => {
			console.log(
				`${colors.yellow(`[${c.method?.toUpperCase()}]`)}: ${c.url}`
			);
			return c;
		});

		this.username = username;
		this.password = password;
		this.db = store;
	}

	public async get(): Promise<Month> {
		const date = new Date();
		await this.db.read();

		if (!this.isLoggedIn()) {
			console.log(colors.gray("Token is expired"));
			await this.login();
		}

		const timesheet = await this.timesheet({ date });

		return timesheet;
	}

	private async login(): Promise<void> {
		if (this.db.data.error) {
			console.log(colors.yellow("Error var is set, see store.json"));
			throw new Error("Password was incorrect last time");
		}

		const session = await this.requests.session();

		const token = await this.requests
			.login(session)
			.catch(async (error) => {
				if (
					axios.isAxiosError(error) &&
					error.response?.status == 200
				) {
					const msg = "Password Login Failed!";
					console.log(colors.red(msg));

					this.db.data.error = true;
					await this.db.write();

					throw new Error(msg);
				}
			});

		if (token) {
			this.updateToken(token);
		}
	}

	private getCache(date: Date): Month | false {
		const key = this.monthYear(date);

		const cache = this.db.data.shifts;

		if (key in cache) {
			const value = cache[key];

			if (
				this.monthPassed(date) ||
				Date.now() - new Date(value.updated).getTime() < CACHE_EXPIRY
			) {
				return value;
			}
		}
		return false;
	}

	private async timesheet({
		date = new Date()
	}: {
		date?: Date;
	}): Promise<Month> {
		const when = this.monthYear(date);

		const cache = this.getCache(date);
		if (cache) return cache;

		const html = await this.requests.timesheet(when);

		const parsed: Month = {
			updated: new Date().toJSON(),
			parsed: this.parseTimesheet(html)
		};

		this.db.data.shifts[when] = parsed;

		await this.db.write();

		return parsed;
	}

	private parseTimesheet(html: string): Shift[] {
		const $ = cheerio.load(html);
		const shiftsElements = $(
			"td[class*=calendarCellRegular]:not(.calendarCellRegularCurrent:has(.calCellData)) table"
		).toArray();
		const shifts = shiftsElements.map((element) => {
			const date = element.attribs["title"].replace("Details van ", "");

			const [start, end] = $("p span", element)
				.toArray()
				.map((el) =>
					new Date(`${date} ${$(el.firstChild!).text()}`).toJSON()
				);

			return {
				start,
				end
			};
		});
		return shifts;
	}

	private firstCookie(headers: AxiosResponse["headers"]): string {
		return headers["set-cookie"][0].split(";")[0] as string;
	}

	private monthYear(date: Date): string {
		return `${date.getMonth() + 1}/${date.getFullYear()}`;
	}
	private monthPassed(date: Date): boolean {
		const now = new Date();
		const thisMonthTheFirst = new Date(
			now.getFullYear(),
			now.getMonth(),
			1
		);
		return thisMonthTheFirst > date;
	}

	private requests = {
		session: async (): Promise<string> => {
			const res = await this.http(timesheetURL);
			return this.firstCookie(res.headers);
		},

		login: async (session: string): Promise<string> => {
			const res = await this.http.post(
				"pkmslogin.form",
				`username=${this.username}&password=${this.password}&login-form-type=pwd`,
				{
					headers: { Cookie: session },
					maxRedirects: 0,
					validateStatus: (s) => s == 302
				}
			);
			return this.firstCookie(res.headers);
		},

		timesheet: async (when?: string): Promise<string> => {
			const res = await this.http(
				`${timesheetURL}?NEW_MONTH_YEAR=${when ?? ""}`,
				{
					headers: { Cookie: this.getToken() },
					maxRedirects: 0
				}
			);
			if (typeof res.data == "string") {
				await this.updateExpiry();
				return res.data;
			} else {
				if (res.data.operation == "login") {
					console.log("Token Expired During request");

					return await this.login().then(
						async () => await this.requests.timesheet(when)
					);
				}
			}
			console.error("Unknown Error");
			console.log(res.data);
			throw new Error("Unknown Error");
		}
	};
}
