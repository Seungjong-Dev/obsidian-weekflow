declare module "ical.js" {
	export class Component {
		static fromString(str: string): Component;
		getAllSubcomponents(name: string): Component[];
	}
	export class Event {
		constructor(component: Component);
		summary: string;
		uid: string;
		startDate: Time;
		endDate: Time;
		isRecurring(): boolean;
		iterator(startTime?: Time): RecurExpansion;
	}
	export class Time {
		static fromJSDate(date: Date, useUTC?: boolean): Time;
		toJSDate(): Date;
		isDate: boolean;
		compare(other: Time): number;
	}
	export class RecurExpansion {
		next(): Time;
		complete: boolean;
	}
}
