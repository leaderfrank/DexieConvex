<script lang="ts">
	import { updated } from '$app/state';
	import {
		Delete,
		Edit,
		File,
		Pencil,
		Phone,
		TableOfContents,
		User,
		UserRound,
		UserRoundPlus,
		X,
		TriangleAlert,
		Check,
		Trash2,
		FilePlus2
	} from '@lucide/svelte';
	import autoAnimate from '@formkit/auto-animate';
	import { onMount } from 'svelte';
	import { db, type Customer, type Invoice } from '$lib/db';
	import { search } from '$lib/states/search.svelte.js';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../convex/_generated/api';
	import { randID } from '../utils/id';
	import { isSyncing } from '$lib/states/sync.svelte';
	import { userId } from '$lib/states/userId.svelte';

	const currentYear = new Date().getFullYear();
	const client = useConvexClient();

	// --- States ---
	let isSingleColumn = $state(false);
	// - customer
	let customerId = $state<string | null>(null);
	let customerName = $state('');
	let customerPhone = $state('');
	// - invoice
	let invoiceId = $state<string | null>(null);
	let invoiceNumber = $state('');
	let invoiceYear = $state('');
	let errorMessage = $state('');

	// --- Delete Confirmation States for Customer ---
	let deleteConfirmationCode = $state('');
	let userDeleteCode = $state('');
	let deleteErrorMessage = $state('');

	// --- Delete Confirmation States for Invoice ---
	let invoiceToDelete = $state<{ id: string; number: number; year: number } | null>(null);
	let invoiceDeleteConfirmationCode = $state('');
	let userInvoiceDeleteCode = $state('');
	let invoiceDeleteErrorMessage = $state('');

	// --- Data States ---
	let customers = $state<(Customer & { lastInvoice?: { number: number; year: number } })[]>([]);
	let invoices = $state<Invoice[]>([]);

	// --- Grid classes ---
	const responsiveGrid = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
	const singleColumnGrid = 'grid-cols-1';

	// Load customers and their last invoices
	async function loadCustomers() {
		try {
			const allCustomers = await db.customers
				.where('userId')
				.equals(userId.value)
				.and((c) => !c.isDeleted)
				.reverse()
				.sortBy('updatedAt');

			// Load last invoice for each customer
			const customersWithInvoices = await Promise.all(
				allCustomers.map(async (customer) => {
					const lastInvoice = await db.invoices
						.where('customerId')
						.equals(customer.id!)
						.and((i) => !i.isDeleted)
						.reverse()
						.sortBy('year')
						.then((invoices) => {
							if (invoices.length > 0) {
								// Get the most recent invoice
								const sorted = invoices.sort((a, b) => {
									if (b.year !== a.year) return b.year - a.year;
									return b.number - a.number;
								});
								return sorted[0] ? { number: sorted[0].number, year: sorted[0].year } : undefined;
							}
							return undefined;
						});

					return { ...customer, lastInvoice };
				})
			);

			// Filter based on search if needed
			if (search.query) {
				const terms = search.query.toLowerCase().split(/\s+/).filter(Boolean);

				customers = customersWithInvoices.filter((c) =>
					terms.every(
						(term) =>
							c.fullName.toLowerCase().includes(term) || c.phone.toLowerCase().includes(term)
					)
				);
			} else {
				customers = customersWithInvoices;
			}
		} catch (error) {
			console.error('Error loading customers:', error);
			errorMessage = 'Failed to load customers';
		}
	}

	// Load invoices for selected customer
	async function loadInvoices() {
		if (!customerId) {
			invoices = [];
			return;
		}

		try {
			const customerInvoices = await db.invoices
				.where('customerId')
				.equals(customerId)
				.and((i) => !i.isDeleted)
				.reverse()
				.sortBy('year');

			// Sort by year desc, then by number desc
			invoices = customerInvoices.sort((a, b) => {
				if (b.year !== a.year) return b.year - a.year;
				return b.number - a.number;
			});
		} catch (error) {
			console.error('Error loading invoices:', error);
			errorMessage = 'Failed to load invoices';
		}
	}

	$effect(() => {
		if (customerId) {
			loadInvoices();
		}
	});

	$effect(() => {
		isSyncing.status;
		search.query;
		loadCustomers();
	});

	$effect(() => {
		const result = isSyncing.status;
		if (!result) {
			loadCustomers();
		}
	});

	// Load saved preference on mount
	onMount(() => {
		const savedView = localStorage.getItem('gridView');
		if (savedView === 'single') {
			isSingleColumn = true;
		}
		loadCustomers();
	});

	function changeView() {
		isSingleColumn = !isSingleColumn;
		localStorage.setItem('gridView', isSingleColumn ? 'single' : 'responsive');
	}

	// Generate random 5-digit code
	function generateDeleteCode() {
		deleteConfirmationCode = Math.floor(10000 + Math.random() * 90000).toString();
		userDeleteCode = '';
		deleteErrorMessage = '';
	}

	// Generate random 5-digit code for invoice deletion
	function generateInvoiceDeleteCode() {
		invoiceDeleteConfirmationCode = Math.floor(10000 + Math.random() * 90000).toString();
		userInvoiceDeleteCode = '';
		invoiceDeleteErrorMessage = '';
	}

	// Open delete confirmation modal
	function openDeleteConfirmation() {
		generateDeleteCode();
		(document.getElementById('delete_confirmation_modal') as HTMLInputElement).checked = true;
	}

	// Open invoice delete confirmation modal
	function openInvoiceDeleteConfirmation(invoice: Invoice) {
		invoiceToDelete = { id: invoice.id!, number: invoice.number, year: invoice.year };
		generateInvoiceDeleteCode();
		(document.getElementById('invoice_delete_confirmation_modal') as HTMLInputElement).checked =
			true;
	}

	// Confirm and delete customer
	async function confirmAndDeleteCustomer() {
		if (userDeleteCode !== deleteConfirmationCode) {
			deleteErrorMessage = 'Incorrect confirmation code. Please try again.';
			return;
		}

		if (!customerId) {
			errorMessage = 'Please select a customer.';
			return;
		}

		try {
			// Soft delete the customer
			await db.customers.update(customerId, {
				isDeleted: true,
				updatedAt: Date.now()
			});

			// soft delete the related invoices
			const invoices = await db.invoices.where('customerId').equals(customerId).toArray();
			await Promise.all(
				invoices.map((invoice) =>
					db.invoices.update(invoice.id!, { isDeleted: true, updatedAt: Date.now() })
				)
			);

			// Update changelog
			const changelog = await db.changelogs.where('userId').equals(userId.value).first();

			if (changelog) {
				await db.changelogs.update(changelog.id!, {
					customers: {
						...changelog.customers,
						edits: changelog.customers.edits + 1
					}
				});
			}

			try {
				client.mutation(api.customers.remove, {
					id: customerId,
					userId: userId.value
				});
			} catch {}

			customerId = null;
			customerName = '';
			customerPhone = '';
			invoiceNumber = '';
			errorMessage = '';
			userDeleteCode = '';
			deleteConfirmationCode = '';
			deleteErrorMessage = '';
			(document.getElementById('delete_confirmation_modal') as HTMLInputElement).checked = false;
			(document.getElementById('view_modal') as HTMLInputElement).checked = false;

			await loadCustomers();
		} catch (error) {
			console.error('Error deleting customer:', error);
			deleteErrorMessage = 'Failed to delete customer. Please try again.';
		}
	}

	// Confirm and delete invoice
	async function confirmAndDeleteInvoice() {
		if (userInvoiceDeleteCode !== invoiceDeleteConfirmationCode) {
			invoiceDeleteErrorMessage = 'Incorrect confirmation code. Please try again.';
			return;
		}

		if (!invoiceToDelete) {
			errorMessage = 'No invoice selected for deletion.';
			return;
		}

		try {
			// Soft delete the invoice
			await db.invoices.update(invoiceToDelete.id, {
				isDeleted: true,
				updatedAt: Date.now()
			});

			// Update changelog
			const changelog = await db.changelogs.where('userId').equals(userId.value).first();

			if (changelog) {
				await db.changelogs.update(changelog.id!, {
					invoices: {
						...changelog.invoices,
						edits: changelog.invoices.edits + 1
					}
				});
			}
			try {
				client.mutation(api.invoices.remove, {
					id: invoiceToDelete.id,
					userId: userId.value
				});
			} catch {}

			invoiceId = null;
			invoiceNumber = '';
			invoiceYear = '';
			errorMessage = '';
			userInvoiceDeleteCode = '';
			invoiceDeleteConfirmationCode = '';
			invoiceDeleteErrorMessage = '';
			invoiceToDelete = null;
			(document.getElementById('invoice_delete_confirmation_modal') as HTMLInputElement).checked =
				false;

			await loadInvoices();
			await loadCustomers(); // Reload to update last invoice
		} catch (error) {
			console.error('Error deleting invoice:', error);
			invoiceDeleteErrorMessage = 'Failed to delete invoice. Please try again.';
		}
	}

	async function addCustomer() {
		if (!customerName || !customerPhone || !invoiceNumber) {
			errorMessage = 'Please fill in all fields.';
			return;
		}
		if (customerName.length < 3) {
			errorMessage = 'Name must be at least 3 characters long.';
			return;
		}
		if (!customerPhone.match(/^\d{9,12}$/)) {
			errorMessage = 'Please enter a valid phone number.';
			return;
		}
		if (!invoiceNumber.match(/^\d+$/)) {
			errorMessage = 'Please enter a valid invoice number.';
			return;
		}

		try {
			const now = Date.now();
			const cId = randID();
			const vId = randID();
			// Add customer
			await db.customers.add({
				id: cId,
				fullName: customerName,
				phone: customerPhone,
				isDeleted: false,
				userId: userId.value,
				creationTime: now,
				updatedAt: now
			});
			// Add first invoice
			await db.invoices.add({
				id: vId,
				number: +invoiceNumber,
				year: currentYear,
				customerId: cId,
				isDeleted: false,
				userId: userId.value,
				creationTime: now,
				updatedAt: now
			});
			// Update or create changelog
			const changelog = await db.changelogs.where('userId').equals(userId.value).first();
			if (changelog) {
				await db.changelogs.update(changelog.id!, {
					customers: {
						...changelog.customers,
						adds: changelog.customers.adds + 1
					},
					invoices: {
						...changelog.invoices,
						adds: changelog.invoices.adds + 1
					}
				});
			} else {
				await db.changelogs.add({
					userId: userId.value,
					customers: { adds: 1, edits: 0 },
					invoices: { adds: 1, edits: 0 }
				});
			}
			try {
				client.mutation(api.customers.addWithInvoice, {
					cId,
					fullName: customerName,
					phone: customerPhone,
					vId,
					invoiceNumber: +invoiceNumber,
					invoiceYear: currentYear,
					userId: userId.value
				});
			} catch {}

			customerName = '';
			customerPhone = '';
			invoiceNumber = '';
			errorMessage = '';

			await loadCustomers();
		} catch (error) {
			console.error('Error adding customer:', error);
			errorMessage = 'Failed to add customer. Please try again.';
		}
	}

	async function addInvoice() {
		if (!customerId) {
			errorMessage = 'Please select a customer.';
			return;
		}
		if (!invoiceNumber) {
			errorMessage = 'Please fill in all fields.';
			return;
		}
		if (!invoiceNumber.match(/^\d+$/)) {
			errorMessage = 'Please enter a valid invoice number.';
			return;
		}

		try {
			const now = Date.now();
			const vId = randID();
			await db.invoices.add({
				id: crypto.randomUUID(),
				number: +invoiceNumber,
				year: currentYear,
				customerId: customerId,
				isDeleted: false,
				userId: userId.value,
				creationTime: now,
				updatedAt: now
			});

			// Update changelog
			const changelog = await db.changelogs.where('userId').equals(userId.value).first();
			if (changelog) {
				await db.changelogs.update(changelog.id!, {
					invoices: {
						...changelog.invoices,
						adds: changelog.invoices.adds + 1
					}
				});
			}
			try {
				client.mutation(api.invoices.add, {
					customerId,
					id: vId,
					invoiceNumber: +invoiceNumber,
					invoiceYear: currentYear,
					userId: userId.value
				});
			} catch {}
			invoiceNumber = '';
			errorMessage = '';

			await loadInvoices();
			await loadCustomers(); // Reload to update last invoice
		} catch (error) {
			console.error('Error adding invoice:', error);
			errorMessage = 'Failed to add invoice. Please try again.';
		}
	}

	async function editCustomer() {
		if (!customerId) {
			errorMessage = 'Please select a customer.';
			return;
		}
		if (!customerName || !customerPhone) {
			errorMessage = 'Please fill in all fields.';
			return;
		}
		if (customerName.length < 3) {
			errorMessage = 'Name must be at least 3 characters long.';
			return;
		}
		if (!customerPhone.match(/^\d{9,12}$/)) {
			errorMessage = 'Please enter a valid phone number.';
			return;
		}

		try {
			const now = Date.now();
			await db.customers.update(customerId, {
				fullName: customerName,
				phone: customerPhone,
				updatedAt: now
			});

			// Update changelog
			const changelog = await db.changelogs.where('userId').equals(userId.value).first();

			if (changelog) {
				await db.changelogs.update(changelog.id!, {
					customers: {
						...changelog.customers,
						edits: changelog.customers.edits + 1
					}
				});
			}
			try {
				client.mutation(api.customers.edit, {
					id: customerId,
					fullName: customerName,
					phone: customerPhone,
					isDeleted: false,
					updatedAt: now,
					userId: userId.value
				});
			} catch {}
			errorMessage = '';
			await loadCustomers();
		} catch (error) {
			console.error('Error editing customer:', error);
			errorMessage = 'Failed to edit customer. Please try again.';
		}
	}

	async function editInvoice() {
		if (!invoiceId) {
			errorMessage = 'Please select an invoice.';
			return;
		}
		if (!invoiceNumber || !invoiceYear) {
			errorMessage = 'Please fill in all fields.';
			return;
		}
		if (!invoiceNumber.match(/^\d/)) {
			errorMessage = 'Please enter a valid invoice number.';
			return;
		}
		if (!invoiceYear.match(/^\d{4}$/)) {
			errorMessage = 'Please enter a valid year.';
			return;
		}

		try {
			const now = Date.now();
			await db.invoices.update(invoiceId, {
				number: +invoiceNumber,
				year: +invoiceYear,
				updatedAt: now
			});

			// Update changelog
			const changelog = await db.changelogs.where('userId').equals(userId.value).first();

			if (changelog) {
				await db.changelogs.update(changelog.id!, {
					invoices: {
						...changelog.invoices,
						edits: changelog.invoices.edits + 1
					}
				});
			}
			try {
				client.mutation(api.invoices.edit, {
					id: invoiceId,
					invoiceNumber: +invoiceNumber,
					invoiceYear: +invoiceYear,
					isDeleted: false,
					updatedAt: now,
					userId: userId.value
				});
			} catch {}
			errorMessage = '';
			invoiceId = null;
			invoiceNumber = '';
			invoiceYear = '';

			await loadInvoices();
			await loadCustomers(); // Reload to update last invoice
		} catch (error) {
			console.error('Error editing invoice:', error);
			errorMessage = 'Failed to edit invoice. Please try again.';
		}
	}
</script>

<div class="flex min-h-[100vh] flex-col justify-between">
	<div
		class="grid gap-4 px-6 pb-36 {isSingleColumn ? singleColumnGrid : responsiveGrid}"
		use:autoAnimate
	>
		{#each customers as card (card.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<label
				class="card-border card w-full cursor-pointer border-base-300 bg-base-100"
				for="view_modal"
				onclick={() => {
					customerId = card.id!;
					customerName = card.fullName;
					customerPhone = card.phone;
					invoiceNumber = '';
				}}
			>
				<div class="stats w-full overflow-hidden bg-base-100 shadow-[0_.1rem_.5rem_-.3rem_#0003]">
					<div class="flex flex-row items-center px-2">
						<div class="stat">
							<div class="stat-value flex flex-wrap items-center gap-4">
								{card.fullName}
								{#if isSingleColumn}
									<div class="badge badge-lg py-4 text-2xl">
										{card.phone}
									</div>
									{#if card.lastInvoice}
										<div
											class="badge badge-lg py-4 {currentYear - card.lastInvoice.year == 0
												? 'badge-primary'
												: currentYear - card.lastInvoice.year < 2
													? 'badge-warning'
													: 'badge-error'}"
										>
											<File size="20" />
											{card.lastInvoice.number}-{Math.ceil(card.lastInvoice.number / 50)} | {card
												.lastInvoice.year}
										</div>
									{/if}
								{/if}
							</div>
							{#if !isSingleColumn}
								<div class="stat-desc flex flex-wrap items-center gap-1 text-lg font-bold">
									<div class="badge badge-lg py-4 text-2xl">
										{card.phone}
									</div>
									{#if card.lastInvoice}
										<div
											class="badge badge-lg py-4 {currentYear - card.lastInvoice.year == 0
												? 'badge-primary'
												: currentYear - card.lastInvoice.year < 2
													? 'badge-warning'
													: 'badge-error'}"
										>
											<File size="20" />
											{card.lastInvoice.number}-{Math.ceil(card.lastInvoice.number / 50)} | {card
												.lastInvoice.year}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				</div>
			</label>
		{/each}
	</div>
	<button
		class="btn fixed right-46 bottom-6 z-50 items-center gap-2 bg-info/70 font-bold backdrop-blur-xs btn-lg btn-info"
		onclick={changeView}
	>
		<TableOfContents />
	</button>
	<label
		class="btn fixed right-6 bottom-6 z-50 w-36 items-center gap-2 bg-primary/70 font-bold text-white backdrop-blur-xs btn-lg btn-primary"
		for="add_modal"
	>
		<UserRoundPlus />
		Add
	</label>
</div>

<!-- Add Modal -->
<input type="checkbox" id="add_modal" class="modal-toggle" />
<div class="modal" role="dialog">
	<div class="modal-box">
		<h3 class="flex flex-row gap-2 text-xl font-bold"><UserRoundPlus size="36" /> Add Customer</h3>
		<div class="flex flex-col gap-1 py-2">
			<label class="input-border input input-lg flex w-full items-center gap-2">
				<User />
				<input
					bind:value={customerName}
					type="text"
					class="grow text-xl"
					placeholder="Full Name"
				/></label
			><span class="flex items-center gap-2 px-1 text-[0.6875rem] text-base-content/60"
				><span class="status inline-block status-error"></span>Name is required</span
			>
		</div>
		<div class="flex flex-col gap-1 py-2">
			<label class="input-border input input-lg flex w-full items-center gap-2"
				><Phone />
				<input
					bind:value={customerPhone}
					type="text"
					class="grow text-xl"
					placeholder="Phone Number"
				/></label
			>
			<span class="flex items-center gap-2 px-1 text-[0.6875rem] text-base-content/60"
				><span class="status inline-block status-error"></span>Phone is required</span
			>
		</div>
		<div class="flex flex-col gap-1 py-2">
			<label class="input-border input input-lg flex w-full items-center gap-2"
				><File />
				<input
					bind:value={invoiceNumber}
					type="text"
					class="grow text-xl"
					placeholder="Invoice Number"
					onkeydown={(e) => e.key === 'Enter' && addCustomer()}
				/></label
			>
			<span class="flex items-center gap-2 px-1 text-[0.6875rem] text-base-content/60"
				><span class="status inline-block status-error"></span> Invoice is required</span
			>
		</div>
		<div class="modal-action">
			{#if errorMessage}
				<div role="alert" class="alert-soft alert w-full alert-error">
					<span>{errorMessage}</span>
				</div>
			{/if}
			<button class="btn btn-lg btn-primary" onclick={addCustomer}>Add</button>
		</div>
	</div>
	<label class="modal-backdrop" for="add_modal">Close</label>
</div>

<!-- View Modal -->
<input type="checkbox" id="view_modal" class="modal-toggle" />
<div class="modal" role="dialog">
	<div class="modal-box">
		<h3 class="flex flex-row gap-2 text-xl font-bold">
			<UserRound size="36" /> View Customer Details
		</h3>
		<div class="flex flex-col gap-1 py-2">
			<label class="input-border input input-lg flex w-full items-center gap-2">
				<User />
				<input
					bind:value={customerName}
					type="text"
					class="grow text-xl"
					placeholder="Full Name"
				/></label
			><span class="flex items-center gap-2 px-1 text-[0.6875rem] text-base-content/60"
				><span class="status inline-block status-error"></span>Name is required</span
			>
		</div>
		<div class="flex flex-col gap-1 py-2">
			<label class="input-border input input-lg flex w-full items-center gap-2"
				><Phone />
				<input
					bind:value={customerPhone}
					type="text"
					class="grow text-xl"
					placeholder="Phone Number"
				/></label
			>
			<span class="flex items-center gap-2 px-1 text-[0.6875rem] text-base-content/60"
				><span class="status inline-block status-error"></span>Phone is required</span
			>
		</div>
		<div class="modal-action justify-between" use:autoAnimate>
			{#if errorMessage}
				<div role="alert" class="alert-soft alert w-full alert-error">
					<span>{errorMessage}</span>
				</div>
			{:else if customerId}
				<button class="btn btn-lg btn-error" onclick={openDeleteConfirmation}
					><Trash2 /> Delete</button
				>
			{/if}
			<button class="btn btn-lg btn-warning" onclick={editCustomer}><Pencil /> Edit</button>
		</div>
		{#if !invoiceId}
			<div class="flex flex-row justify-between gap-2 pt-8">
				<div class="flex w-full flex-col gap-1">
					<label class="input-border input input-lg flex w-full items-center gap-2"
						><File />
						<input
							bind:value={invoiceNumber}
							type="text"
							class="grow text-xl"
							placeholder="Invoice Number"
							onkeydown={(e) => e.key === 'Enter' && addInvoice()}
						/></label
					>
				</div>
				<button class="btn items-center gap-2 btn-lg btn-primary" onclick={addInvoice}>
					<FilePlus2 />
					Add
				</button>
			</div>
		{/if}
		<ul class="list mt-8 max-h-40 space-y-2" use:autoAnimate>
			{#if invoices.length === 0}
				<li class="list-row border-2 border-base-300">
					<div
						class="flex w-full items-center justify-center py-8 text-center text-lg font-semibold opacity-60"
					>
						No invoices found.
					</div>
				</li>
			{:else}
				{#each invoices as invoice (invoice.id)}
					<li class="list-row border-2 border-base-300">
						<div></div>
						<div>
							<div class="text-2xl font-bold" use:autoAnimate>
								{#if invoiceId === invoice.id}
									<input
										bind:value={invoiceNumber}
										type="text"
										class="input-bordered input input-lg"
										placeholder="Invoice Number"
									/>
								{:else}
									{invoice.number} - {Math.ceil(invoice.number / 50)}
								{/if}
							</div>
							<div class="mt-2 font-semibold uppercase opacity-80" use:autoAnimate>
								{#if invoiceId === invoice.id}
									<input
										bind:value={invoiceYear}
										type="text"
										class="input-bordered input input-lg"
										placeholder="Year"
									/>
								{:else}
									{invoice.year}
								{/if}
							</div>
						</div>
						<button
							class="btn btn-square btn-ghost"
							onclick={() => {
								if (invoiceId) {
									editInvoice();
								} else {
									invoiceId = invoice.id!;
									invoiceNumber = invoice.number.toString();
									invoiceYear = invoice.year.toString();
								}
							}}
						>
							{#if invoiceId === invoice.id}
								<Check />
							{:else}
								<Pencil />
							{/if}
						</button>
						<button
							class="btn btn-square btn-ghost"
							onclick={() => {
								if (invoiceId) {
									invoiceId = null;
									invoiceNumber = '';
									invoiceYear = '';
								} else {
									openInvoiceDeleteConfirmation(invoice);
								}
							}}
						>
							{#if invoiceId === invoice.id}
								<X />
							{:else}
								<Trash2 />
							{/if}
						</button>
					</li>
					<p class="pb-2"></p>
				{/each}
			{/if}
		</ul>
	</div>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<label
		class="modal-backdrop"
		for="view_modal"
		onclick={() => {
			setTimeout(() => {
				customerName = '';
				customerPhone = '';
				invoiceNumber = '';
				errorMessage = '';
				customerId = null;
				invoiceId = null;
				invoiceYear = '';
			}, 500);
		}}
	>
		Close
	</label>
</div>

<!-- Delete Confirmation Modal -->
<input type="checkbox" id="delete_confirmation_modal" class="modal-toggle" />
<div class="modal" role="dialog">
	<div class="modal-box">
		<h3 class="flex flex-row items-center gap-2 text-xl font-bold text-error">
			<TriangleAlert size="36" /> Confirm Deletion
		</h3>

		<div class="mt-4 alert alert-warning">
			<TriangleAlert />
			<span>
				<strong>Warning:</strong> You are about to permanently delete customer
				<strong>"{customerName}"</strong>. This action cannot be undone.
			</span>
		</div>

		<div class="mt-6 space-y-4">
			<div class="text-center">
				<p class="mb-2 text-sm text-base-content/70">Type this code to confirm deletion:</p>
				<div class="font-mono text-4xl font-bold tracking-wider text-error">
					{deleteConfirmationCode}
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<input
					bind:value={userDeleteCode}
					type="text"
					class="input-bordered input input-lg w-full text-center font-mono text-2xl tracking-wider"
					placeholder="Enter code"
					maxlength="5"
					pattern="[0-9]{5}"
					onkeydown={(e) => e.key === 'Enter' && confirmAndDeleteCustomer()}
				/>
				{#if deleteErrorMessage}
					<span class="mt-1 text-sm text-error">{deleteErrorMessage}</span>
				{/if}
			</div>
		</div>

		<div class="modal-action">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<label
				class="btn btn-ghost btn-lg"
				for="delete_confirmation_modal"
				onclick={() => {
					userDeleteCode = '';
					deleteConfirmationCode = '';
					deleteErrorMessage = '';
				}}
			>
				Cancel
			</label>
			<button
				class="btn btn-lg btn-error"
				onclick={confirmAndDeleteCustomer}
				disabled={userDeleteCode.length !== 5}
			>
				Confirm Delete
			</button>
		</div>
	</div>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<label
		class="modal-backdrop"
		for="delete_confirmation_modal"
		onclick={() => {
			userDeleteCode = '';
			deleteConfirmationCode = '';
			deleteErrorMessage = '';
		}}
	>
		Close
	</label>
</div>

<!-- Invoice Delete Confirmation Modal -->
<input type="checkbox" id="invoice_delete_confirmation_modal" class="modal-toggle" />
<div class="modal" role="dialog">
	<div class="modal-box">
		<h3 class="flex flex-row items-center gap-2 text-xl font-bold text-error">
			<TriangleAlert size="36" /> Confirm Invoice Deletion
		</h3>

		<div class="mt-4 alert alert-warning">
			<TriangleAlert />
			<span>
				<strong>Warning:</strong> You are about to permanently delete invoice
				{#if invoiceToDelete}
					<strong>#{invoiceToDelete.number} ({invoiceToDelete.year})</strong>
				{/if}
				. This action cannot be undone.
			</span>
		</div>

		<div class="mt-6 space-y-4">
			<div class="text-center">
				<p class="mb-2 text-sm text-base-content/70">Type this code to confirm deletion:</p>
				<div class="font-mono text-4xl font-bold tracking-wider text-error">
					{invoiceDeleteConfirmationCode}
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<input
					bind:value={userInvoiceDeleteCode}
					type="text"
					class="input-bordered input input-lg w-full text-center font-mono text-2xl tracking-wider"
					placeholder="Enter code"
					maxlength="5"
					pattern="[0-9]{5}"
					onkeydown={(e) => e.key === 'Enter' && confirmAndDeleteInvoice()}
				/>
				{#if invoiceDeleteErrorMessage}
					<span class="mt-1 text-sm text-error">{invoiceDeleteErrorMessage}</span>
				{/if}
			</div>
		</div>

		<div class="modal-action">
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<label
				class="btn btn-ghost btn-lg"
				for="invoice_delete_confirmation_modal"
				onclick={() => {
					userInvoiceDeleteCode = '';
					invoiceDeleteConfirmationCode = '';
					invoiceDeleteErrorMessage = '';
					invoiceToDelete = null;
				}}
			>
				Cancel
			</label>
			<button
				class="btn btn-lg btn-error"
				onclick={confirmAndDeleteInvoice}
				disabled={userInvoiceDeleteCode.length !== 5}
			>
				Confirm Delete
			</button>
		</div>
	</div>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<label
		class="modal-backdrop"
		for="invoice_delete_confirmation_modal"
		onclick={() => {
			userInvoiceDeleteCode = '';
			invoiceDeleteConfirmationCode = '';
			invoiceDeleteErrorMessage = '';
			invoiceToDelete = null;
		}}
	>
		Close
	</label>
</div>
