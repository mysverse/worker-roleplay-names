export interface Env {
	TRELLO_API_KEY?: string;
	TRELLO_API_TOKEN?: string;
	TRELLO_BOARD_ID?: string;
	MY_CACHE: KVNamespace;
}

interface RoleplayNameData {
	roleplayName: string;
	properties?: { [k: string]: string };
	userName: string;
	description?: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { TRELLO_BOARD_ID, TRELLO_API_KEY, TRELLO_API_TOKEN, MY_CACHE } = env;

		function parseDetails(details: string) {
			const lines = details.split('\n').filter((line) => line.trim() !== ''); // Split by newline and filter out empty lines
			const obj: { [k: string]: string } = {};
			let currentKey: string | undefined = undefined;

			lines.forEach((line) => {
				if (line.includes(':')) {
					const [key, value] = line.split(':').map((part) => part.trim()); // Split by colon and trim whitespace
					currentKey = key.replace(/\*\*/g, ''); // Remove markdown asterisks and set as the current key
					if (currentKey) {
						const newValue = value.replace(/\*\*/g, '').trim();
						if (newValue.length > 0) {
							obj[currentKey] = value.replace(/\*\*/g, '').trim(); // Assign the initial value for this key
						}
					}
				} else {
					// If no colon is present, it's a continuation of the last key's value
					if (currentKey) {
						obj[currentKey] += ', ' + line.trim(); // Append this line to the existing value of the current key
					}
				}
			});

			if (Object.keys(obj).length > 0) {
				return obj;
			}

			return undefined;
		}

		function processData(data: any[]) {
			return data
				.map((item: any) => {
					let ign: string | undefined = undefined;
					let description = item.desc as string | undefined;
					if (description) {
						if (description.replaceAll(/\s/g, '').length === 0) {
							description = undefined;
						}
					}
					let properties = description ? parseDetails(description) : undefined;
					if (properties) {
						const propertiesIgn = properties['IGN'];
						if (propertiesIgn) {
							ign = propertiesIgn;
							delete properties['IGN'];
						}
					}

					if (typeof ign === 'undefined') {
						const amazingFields = item['amazingFields'];
						if (amazingFields && amazingFields.fields) {
							const fields = amazingFields.fields as any[];
							for (const field of fields) {
								if (field.name === 'Honorary Titles') {
									ign = field.value;
									break;
								}
							}
						}
					}

					if (ign) {
						const roleplayName = item.name;
						if (roleplayName && roleplayName !== 'Template') {
							const returned: RoleplayNameData = {
								roleplayName,
								userName: ign,
								properties,
								// description,
							};
							return returned;
						}
					}
				})
				.filter((item): item is RoleplayNameData => !!item);
		}

		async function getUserIds(usernames: string[]) {
			const response = await fetch(`https://users.roblox.com/v1/usernames/users`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ usernames: usernames, excludeBannedUsers: true }),
			});

			if (!response.ok) {
				console.error('Failed to fetch user IDs');
				return [];
			}

			const data = (await response.json()) as any;
			return data.data.map((user: any) => ({ requestedUsername: user.requestedUsername, username: user.name, id: user.id }));
		}

		// Function to handle fetching and caching card data
		async function fetchAndCacheCards() {
			const cacheKey = `cardData_${TRELLO_BOARD_ID}`;
			let cached = await MY_CACHE.get(cacheKey, 'json');

			if (cached && typeof cached === 'object') {
				return cached;
			}

			const url = new URL(`https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/cards`);

			if (!TRELLO_API_KEY) {
				throw new Error('No Trello API key');
			}

			if (!TRELLO_API_TOKEN) {
				throw new Error('No Trello API token');
			}

			url.searchParams.set('key', TRELLO_API_KEY);
			url.searchParams.set('token', TRELLO_API_TOKEN);

			const response = await fetch(`https://api.trello.com/1/boards/${TRELLO_BOARD_ID}/cards`);

			if (!response.ok) {
				console.error(await response.json());
				throw new Error('Failed to fetch data from API');
			}

			const data = (await response.json()) as any;

			const members = processData(data);
			const usernames = members.map((member) => member.userName);
			const userIds = await getUserIds(usernames);

			// Map user IDs back to members data
			const memberDetails = members
				.map((member) => {
					const user = userIds.find((u: any) => u.requestedUsername === member.userName);
					if (user) {
						return { ...member, userId: user.id, userName: user.username };
					}
					return null;
				})
				.filter((item) => !!item);

			await MY_CACHE.put(cacheKey, JSON.stringify(memberDetails), { expirationTtl: 60 }); // Cache for 1 minute

			return memberDetails;
		}

		try {
			const data = (await fetchAndCacheCards()) as any;
			return new Response(JSON.stringify(data), {
				headers: { 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Error:', error);
			return new Response('Internal Server Error', { status: 500 });
		}
	},
};
