import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	changelogs: defineTable({
		userId: v.string(),
		customers: v.object({
			adds: v.number(),
			edits: v.number()
		}),
		invoices: v.object({
			adds: v.number(),
			edits: v.number()
		})
	}).index('by_user', ['userId']),
	customers: defineTable({
		id: v.string(),
		fullName: v.string(),
		phone: v.string(),
		isDeleted: v.boolean(),
		userId: v.string(),
		updatedAt: v.number()
	})
		.index('by_user', ['userId'])
		.index('by_cId', ['id'])
		.index('by_user_updateAt', ['userId', 'updatedAt']),
	invoices: defineTable({
		id: v.string(),
		number: v.number(),
		year: v.number(),
		customerId: v.string(),
		isDeleted: v.boolean(),
		userId: v.string(),
		updatedAt: v.number()
	})
		.index('by_user', ['userId'])
		.index('by_vId', ['id'])
		.index('by_user_customer', ['userId', 'customerId'])
		.index('by_user_updateAt', ['userId', 'updatedAt'])
});
