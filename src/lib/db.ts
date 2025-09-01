// src/lib/db.ts
import Dexie, { type Table } from 'dexie';

export interface Changelog {
	id?: number;
	userId: string;
	customers: {
		adds: number;
		edits: number;
	};
	invoices: {
		adds: number;
		edits: number;
	};
}

export interface Customer {
	id?: string;
	_id?: string;
	fullName: string;
	phone: string;
	isDeleted: boolean;
	userId: string;
	creationTime: number;
	updatedAt: number;
}

export interface Invoice {
	id?: string;
	_id?: string;
	number: number;
	year: number;
	customerId: string;
	isDeleted: boolean;
	userId: string;
	creationTime: number;
	updatedAt: number;
}

export class AppDB extends Dexie {
	changelogs!: Table<Changelog, number>;
	customers!: Table<Customer, string>;
	invoices!: Table<Invoice, string>;

	constructor() {
		super('AppDB');
		this.version(1).stores({
			changelogs: '++id, userId', // auto-increment id + index on userId
			customers: 'id, userId', // id as primary key + index on userId
			invoices: 'id, userId, customerId' // indexes for filtering
		});
	}
}

export const db = new AppDB();
