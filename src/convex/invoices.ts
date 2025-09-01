import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const getAll = query({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		return await ctx.db
			.query('invoices')
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
				.query('invoices')
				.withIndex('by_user', (q) => q.eq('userId', userId))
				.order('desc')
				.take(limit);
		} else {
			return await ctx.db
				.query('invoices')
				.withIndex('by_user_updateAt', (q) => q.eq('userId', userId))
				.order('desc')
				.take(limit);
		}
	}
});

export const add = mutation({
	args: {
		id: v.string(),
		customerId: v.string(),
		invoiceNumber: v.number(),
		invoiceYear: v.number(),
		userId: v.string()
	},
	handler: async (ctx, { customerId, invoiceNumber, invoiceYear, userId, id }) => {
		if (!customerId) {
			return false;
		}
		const invoiceId = await ctx.db.insert('invoices', {
			id,
			number: invoiceNumber,
			year: invoiceYear,
			customerId: customerId,
			isDeleted: false,
			userId: userId,
			updatedAt: Date.now()
		});
		if (!invoiceId) {
			return false;
		}
		const changelogs = await ctx.db
			.query('changelogs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		if (changelogs) {
			await ctx.db.patch(changelogs._id, {
				invoices: { adds: changelogs.invoices.adds + 1, edits: changelogs.invoices.edits }
			});
		} else {
			await ctx.db.insert('changelogs', {
				userId: userId,
				customers: { adds: 0, edits: 0 },
				invoices: { adds: 1, edits: 0 }
			});
		}
		return true;
	}
});

export const edit = mutation({
	args: {
		id: v.string(),
		invoiceNumber: v.number(),
		invoiceYear: v.number(),
		isDeleted: v.boolean(),
		updatedAt: v.number(),
		userId: v.string()
	},
	handler: async (ctx, { id, invoiceNumber, invoiceYear, userId, isDeleted, updatedAt }) => {
		const changelogs = await ctx.db
			.query('changelogs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		const v = await ctx.db
			.query('invoices')
			.withIndex('by_vId', (q) => q.eq('id', id))
			.unique();
		if (v?.userId === userId) {
			await ctx.db.patch(v._id, {
				number: invoiceNumber,
				year: invoiceYear,
				isDeleted,
				updatedAt
			});
			if (changelogs) {
				await ctx.db.patch(changelogs._id, {
					invoices: { adds: changelogs.invoices.adds, edits: changelogs.invoices.edits + 1 }
				});
			} else {
				await ctx.db.insert('changelogs', {
					userId: userId,
					customers: { adds: 0, edits: 0 },
					invoices: { adds: 0, edits: 1 }
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
		const v = await ctx.db
			.query('invoices')
			.withIndex('by_vId', (q) => q.eq('id', id))
			.unique();
		if (v?.userId === userId) {
			await ctx.db.patch(v._id, { isDeleted: true, updatedAt: Date.now() });
			if (changelogs) {
				await ctx.db.patch(changelogs._id, {
					invoices: { adds: changelogs.invoices.adds, edits: changelogs.invoices.edits + 1 }
				});
			} else {
				await ctx.db.insert('changelogs', {
					userId: userId,
					customers: { adds: 0, edits: 0 },
					invoices: { adds: 0, edits: 1 }
				});
			}
			return true;
		}
	}
});
