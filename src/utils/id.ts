export const randID = (length: number = 16): string => {
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(36).padStart(2, '0'))
		.join('')
		.slice(0, length);
};
