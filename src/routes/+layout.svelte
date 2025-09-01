<script lang="ts">
	import '../app.css';
	import { onDestroy, onMount } from 'svelte';
	import { Search, SunMoon } from '@lucide/svelte';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvex, useConvexClient } from 'convex-svelte';
	import { search } from '$lib/states/search.svelte';
	import { db } from '$lib/db';
	import { api } from '../convex/_generated/api';
	import { isSyncing } from '$lib/states/sync.svelte';
	import { userId } from '$lib/states/userId.svelte';
	let { children } = $props();
	setupConvex(PUBLIC_CONVEX_URL);

	// States
	let theme = $state('light');
	let searchInput = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;
	const client = useConvexClient();
	let syncInterval: ReturnType<typeof setInterval>;
	let syncStatus = $state<'idle' | 'syncing' | 'success' | 'error'>('idle');
	// Debounced search effect
	$effect(() => {
		const currentSearch = searchInput;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			search.query = currentSearch;
		}, 700);
		return () => clearTimeout(debounceTimer);
	});

	async function syncChangelogs() {
		if (isSyncing.status) return; // Prevent overlapping syncs
		try {
			isSyncing.status = true;
			syncStatus = 'syncing';
			// Get local changelog from Dexie
			const localChangelog = await db.changelogs.where('userId').equals(userId.value).first();
			// Get remote changelog from Convex
			const remoteChangelog = await client.query(api.changelogs.get, { userId: userId.value });

			if (!remoteChangelog) {
				// If no remote changelog exists but we have local, push local to remote
				if (localChangelog) {
					await client.mutation(api.changelogs.add, {
						userId: userId.value,
						customers: { adds: 0, edits: 0 },
						invoices: { adds: 0, edits: 0 }
					});
				}
				syncStatus = 'success';
				return;
			}

			if (!localChangelog) {
				// If no local changelog exists but we have remote, pull remote to local
				await db.changelogs.add({
					userId: userId.value,
					customers: { adds: 0, edits: 0 },
					invoices: { adds: 0, edits: 0 }
				});

				syncStatus = 'success';
				return;
			}

			if (remoteChangelog.customers.adds > localChangelog.customers.adds) {
				const difNumber = remoteChangelog.customers.adds - localChangelog.customers.adds;

				const customers = await client.query(api.customers.getLimit, {
					userId: userId.value,
					type: 'created',
					limit: difNumber * 3
				});

				for (const customer of customers) {
					try {
						await db.customers.add({
							id: customer.id,
							fullName: customer.fullName,
							phone: customer.phone,
							isDeleted: customer.isDeleted,
							userId: customer.userId,
							creationTime: customer._creationTime,
							updatedAt: customer.updatedAt
						});
					} catch (error) {
						console.error('Error adding customers:', error);
					}
				}

				await db.changelogs.update(localChangelog.id!, {
					customers: {
						...localChangelog.customers,
						adds: localChangelog.customers.adds + difNumber
					}
				});
			} else if (remoteChangelog.customers.adds < localChangelog.customers.adds) {
				const difNumber = localChangelog.customers.adds - remoteChangelog.customers.adds;

				// get last difNumber customers from local
				const customers = await db.customers
					.where('userId')
					.equals(userId.value)
					.limit(difNumber)
					.sortBy('creationTime');

				for (const customer of customers) {
					await client.mutation(api.customers.add, {
						cId: customer.id!,
						fullName: customer.fullName,
						phone: customer.phone,
						userId: userId.value
					});
				}
			}
			if (remoteChangelog.customers.edits > localChangelog.customers.edits) {
				const difNumber = remoteChangelog.customers.edits - localChangelog.customers.edits;
				const customers = await client.query(api.customers.getLimit, {
					userId: userId.value,
					type: 'updated',
					limit: difNumber * 3
				});
				for (const customer of customers) {
					await db.customers.update(customer.id, {
						fullName: customer.fullName,
						phone: customer.phone,
						isDeleted: customer.isDeleted,
						userId: customer.userId,
						creationTime: customer._creationTime,
						updatedAt: customer.updatedAt
					});
				}
				await db.changelogs.update(localChangelog.id!, {
					customers: {
						...localChangelog.customers,
						edits: localChangelog.customers.edits + difNumber
					}
				});
			} else if (remoteChangelog.customers.edits < localChangelog.customers.edits) {
				const difNumber = localChangelog.customers.edits - remoteChangelog.customers.edits;
				// get last difNumber customers from local
				const customers = await db.customers
					.where('userId')
					.equals(userId.value)
					.limit(difNumber)
					.sortBy('updatedAt');
				for (const customer of customers) {
					try {
						await client.mutation(api.customers.edit, {
							id: customer.id!,
							fullName: customer.fullName,
							phone: customer.phone,
							isDeleted: customer.isDeleted,
							updatedAt: customer.updatedAt,
							userId: userId.value
						});
					} catch (error) {
						console.error('Error editing customers:', error);
					}
				}
			}
			if (remoteChangelog.invoices.adds > localChangelog.invoices.adds) {
				const difNumber = remoteChangelog.invoices.adds - localChangelog.invoices.adds;

				const invoices = await client.query(api.invoices.getLimit, {
					userId: userId.value,
					type: 'created',
					limit: difNumber * 3
				});

				for (const invoice of invoices) {
					try {
						await db.invoices.add({
							id: invoice.id,
							number: invoice.number,
							year: invoice.year,
							customerId: invoice.customerId,
							isDeleted: invoice.isDeleted,
							userId: invoice.userId,
							creationTime: invoice._creationTime,
							updatedAt: invoice.updatedAt
						});
					} catch (error) {
						console.error('Error adding invoices:', error);
					}
				}
				await db.changelogs.update(localChangelog.id!, {
					invoices: {
						...localChangelog.invoices,
						adds: localChangelog.invoices.adds + difNumber
					}
				});
			} else if (remoteChangelog.invoices.adds < localChangelog.invoices.adds) {
				const difNumber = localChangelog.invoices.adds - remoteChangelog.invoices.adds;
				// get last difNumber invoices from local
				const invoices = await db.invoices
					.where('userId')
					.equals(userId.value)
					.limit(difNumber)
					.sortBy('creationTime');
				for (const invoice of invoices) {
					await client.mutation(api.invoices.add, {
						customerId: invoice.customerId,
						id: invoice.id!,
						invoiceNumber: invoice.number,
						invoiceYear: invoice.year,
						userId: userId.value
					});
				}
			}
			if (remoteChangelog.invoices.edits > localChangelog.invoices.edits) {
				const difNumber = remoteChangelog.invoices.edits - localChangelog.invoices.edits;
				const invoices = await client.query(api.invoices.getLimit, {
					userId: userId.value,
					type: 'updated',
					limit: difNumber * 3
				});
				for (const invoice of invoices) {
					try {
						await db.invoices.update(invoice.id, {
							number: invoice.number,
							year: invoice.year,
							customerId: invoice.customerId,
							isDeleted: invoice.isDeleted,
							userId: invoice.userId,
							creationTime: invoice._creationTime,
							updatedAt: invoice.updatedAt
						});
					} catch (error) {
						console.error('Error editing invoices:', error);
					}
				}
				await db.changelogs.update(localChangelog.id!, {
					invoices: {
						...localChangelog.invoices,
						edits: localChangelog.invoices.edits + difNumber
					}
				});
			} else if (remoteChangelog.invoices.edits < localChangelog.invoices.edits) {
				const difNumber = localChangelog.invoices.edits - remoteChangelog.invoices.edits;
				// get last difNumber invoices from local
				const invoices = await db.invoices
					.where('userId')
					.equals(userId.value)
					.limit(difNumber)
					.sortBy('updatedAt');
				for (const invoice of invoices) {
					await client.mutation(api.invoices.edit, {
						id: invoice.id!,
						invoiceNumber: invoice.number,
						invoiceYear: invoice.year,
						isDeleted: invoice.isDeleted,
						updatedAt: invoice.updatedAt,
						userId: userId.value
					});
				}
			}
			syncStatus = 'success';
		} catch (error) {
			console.error('Error syncing changelogs:', error);
			syncStatus = 'error';
		} finally {
			isSyncing.status = false;
		}
	}

	onMount(() => {
		// Load saved theme or fall back to system preference
		const saved = localStorage.getItem('theme');
		if (saved) {
			theme = saved;
		} else {
			theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		document.documentElement.setAttribute('data-theme', theme);
		// Initial sync
		syncChangelogs();

		// Set up periodic sync every 30 seconds
		syncInterval = setInterval(() => {
			syncChangelogs();
		}, 30000); // 30 seconds

		// Optional: Sync when window regains focus
		const handleFocus = () => {
			syncChangelogs();
		};
		window.addEventListener('focus', handleFocus);

		return () => {
			window.removeEventListener('focus', handleFocus);
		};
	});

	onDestroy(() => {
		if (syncInterval) {
			clearInterval(syncInterval);
		}
	});

	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		document.documentElement.setAttribute('data-theme', theme);
		localStorage.setItem('theme', theme);
	}

	async function detectSWUpdate() {
		const registration = await navigator.serviceWorker.ready;
		registration.addEventListener('updatefound', () => {
			const newSW = registration.installing;
			newSW?.addEventListener('statechange', () => {
				if (newSW.state == 'installed') {
					if (confirm('A new version is available. Do you want to refresh?')) {
						newSW.postMessage({ type: 'SKIP_WAITING' });
						window.location.reload();
					}
				}
			});
		});
	}

	onMount(() => {
		detectSWUpdate();
	});
</script>

<div class="bg-base-200 text-base-content transition-colors duration-500">
	<div
		class="sticky top-6 z-50 mx-6 flex flex-row justify-between gap-8 rounded-lg bg-base-100/60 p-4 shadow-sm backdrop-blur-md"
	>
		<label class="input-border input input-lg flex w-full items-center gap-2">
			<Search />
			<input
				bind:value={searchInput}
				type="text"
				placeholder="Search for name or phone"
				class="text-2xl font-semibold"
			/>
		</label>

		<label class="swap swap-rotate">
			<input type="checkbox" onchange={toggleTheme} checked={theme === 'dark'} />
			<SunMoon size="32" />
		</label>
	</div>
	<div class="mt-12">
		{@render children?.()}
	</div>
</div>
