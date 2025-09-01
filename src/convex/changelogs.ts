import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export const get = query({
	args: { userId: v.string() },
	handler: async (ctx, { userId }) => {
		return await ctx.db
			.query('changelogs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.order('desc')
			.unique();
	}
});

export const add = mutation({
	args: {
		userId: v.string(),
		customers: v.object({
			adds: v.number(),
			edits: v.number()
		}),
		invoices: v.object({
			adds: v.number(),
			edits: v.number()
		})
	},
	handler: async (ctx, { userId, customers, invoices }) => {
		await ctx.db.insert('changelogs', {
			userId: userId,
			customers: customers,
			invoices: invoices
		});
		return true;
	}
});
