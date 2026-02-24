declare module "ical.js" {
	export class Component {
		static fromString(str: string): Component;
		getAllSubcomponents(name: string): Component[];
		hasProperty(name: string): boolean;
	}
	export interface OccurrenceDetails {
		recurrenceId: Time;
		startDate: Time;
		endDate: Time;
		item: Event;
	}
	export class Event {
		constructor(component: Component);
		summary: string;
		uid: string;
		startDate: Time;
		endDate: Time;
		isRecurring(): boolean;
		isRecurrenceException(): boolean;
		iterator(startTime?: Time): RecurExpansion;
		getOccurrenceDetails(occurrence: Time): OccurrenceDetails;
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
