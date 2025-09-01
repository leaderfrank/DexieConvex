import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const getAll = query({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		return await ctx.db
			.query('customers')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.order('desc')
			.collect();
	}
});

export const getLimit = query({
	args: {
		userId: v.string(),
		type: v.union(v.literal('created'), v.literal('updated')),
		limit: v.number()
	},
	handler: async (ctx, { userId, type, limit }) => {
		if (type === 'created') {
			return await ctx.db
				.query('customers')
				.withIndex('by_user', (q) => q.eq('userId', userId))
				.order('desc')
				.take(limit);
		} else {
			return await ctx.db
				.query('customers')
				.withIndex('by_user_updateAt', (q) => q.eq('userId', userId))
				.order('desc')
				.take(limit);
		}
	}
});

export const addWithInvoice = mutation({
	args: {
		cId: v.string(),
		fullName: v.string(),
		phone: v.string(),
		invoiceNumber: v.number(),
		invoiceYear: v.number(),
		userId: v.string(),
		vId: v.string()
	},
	handler: async (ctx, { fullName, phone, invoiceNumber, userId, cId, vId, invoiceYear }) => {
		const changelogs = await ctx.db
			.query('changelogs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		const customerId = await ctx.db.insert('customers', {
			id: cId,
			fullName: fullName,
			phone: phone,
			isDeleted: false,
			userId: userId,
			updatedAt: Date.now()
		});
		if (!customerId) {
			return false;
		}
		const invoiceId = await ctx.db.insert('invoices', {
			id: vId,
			number: invoiceNumber,
			year: invoiceYear,
			customerId: cId,
			isDeleted: false,
			userId: userId,
			updatedAt: Date.now()
		});
		if (!invoiceId) {
			return false;
		}
		if (changelogs) {
			await ctx.db.patch(changelogs._id, {
				customers: { adds: changelogs.customers.adds + 1, edits: changelogs.customers.edits },
				invoices: { adds: changelogs.invoices.adds + 1, edits: changelogs.invoices.edits }
			});
		} else {
			await ctx.db.insert('changelogs', {
				userId: userId,
				customers: { adds: 1, edits: 0 },
				invoices: { adds: 1, edits: 0 }
			});
		}
		return true;
	}
});

export const add = mutation({
	args: {
		cId: v.string(),
		fullName: v.string(),
		phone: v.string(),
		userId: v.string()
	},
	handler: async (ctx, { fullName, phone, userId, cId }) => {
		const changelogs = await ctx.db
			.query('changelogs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		await ctx.db.insert('customers', {
			id: cId,
			fullName: fullName,
			phone: phone,
			isDeleted: false,
			userId: userId,
			updatedAt: Date.now()
		});
		if (changelogs) {
			await ctx.db.patch(changelogs._id, {
				customers: { adds: changelogs.customers.adds + 1, edits: changelogs.customers.edits },
				invoices: { adds: changelogs.invoices.adds, edits: changelogs.invoices.edits }
			});
		} else {
			await ctx.db.insert('changelogs', {
				userId: userId,
				customers: { adds: 1, edits: 0 },
				invoices: { adds: 0, edits: 0 }
			});
		}
		return true;
	}
});

export const edit = mutation({
	args: {
		id: v.string(),
		fullName: v.string(),
		phone: v.string(),
		userId: v.string(),
		isDeleted: v.boolean(),
		updatedAt: v.number()
	},
	handler: async (ctx, { id, fullName, phone, userId, isDeleted, updatedAt }) => {
		const changelogs = await ctx.db
			.query('changelogs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		const c = await ctx.db
			.query('customers')
			.withIndex('by_cId', (q) => q.eq('id', id))
			.unique();
		if (c?.userId === userId) {
			await ctx.db.patch(c._id, {
				fullName: fullName,
				phone: phone,
				isDeleted,
				updatedAt
			});
			if (changelogs) {
				await ctx.db.patch(changelogs._id, {
					customers: { adds: changelogs.customers.adds, edits: changelogs.customers.edits + 1 }
				});
			} else {
				await ctx.db.insert('changelogs', {
					userId: userId,
					customers: { adds: 0, edits: 1 },
					invoices: { adds: 0, edits: 0 }
				});
			}
			return true;
		}
	}
});

export const remove = mutation({
	args: {
		id: v.string(),
		userId: v.string()
	},
	handler: async (ctx, { id, userId }) => {
		const changelogs = await ctx.db
			.query('changelogs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		const c = await ctx.db
			.query('customers')
			.withIndex('by_cId', (q) => q.eq('id', id))
			.unique();
		if (c?.userId === userId) {
			const invoices = await ctx.db
				.query('invoices')
				.withIndex('by_user_customer', (q) => q.eq('userId', userId).eq('customerId', c.id))
				.collect();
			console.log(invoices);
			await Promise.all(
				invoices.map((invoice) =>
					ctx.db.patch(invoice._id, { isDeleted: true, updatedAt: Date.now() })
				)
			);
			await ctx.db.patch(c._id, { isDeleted: true, updatedAt: Date.now() });
			if (changelogs) {
				await ctx.db.patch(changelogs._id, {
					customers: { adds: changelogs.customers.adds, edits: changelogs.customers.edits + 1 },
					invoices: {
						adds: changelogs.invoices.adds,
						edits: changelogs.invoices.edits + invoices.length
					}
				});
			} else {
				await ctx.db.insert('changelogs', {
					userId: userId,
					customers: { adds: 0, edits: 1 },
					invoices: { adds: 0, edits: invoices.length }
				});
			}
			return true;
		}
	}
});
