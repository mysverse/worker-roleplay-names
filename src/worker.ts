export interface Env {
	AMAZING_FIELDS_TOKEN?: string;
	TRELLO_BOARD_ID?: string;
	MY_CACHE: KVNamespace;
}

interface RoleplayNameData {
	roleplayName: string;
	userName: string;
	description?: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { TRELLO_BOARD_ID, AMAZING_FIELDS_TOKEN, MY_CACHE } = env;
		console.assert(typeof TRELLO_BOARD_ID !== 'undefined' && typeof AMAZING_FIELDS_TOKEN !== 'undefined');

		function processData(data: any[]) {
			return data
				.map((item: any) => {
					const amazingFields = item['amazingFields'];
					if (amazingFields && amazingFields.fields) {
						const fields = amazingFields.fields as any[];
						let ign: string | undefined = undefined;
						for (const field of fields) {
							if (field.name === 'IGN') {
								ign = field.value;
								break;
							}
						}
						if (ign) {
							const roleplayName = item.name;
							let description = item.desc as string | undefined;
							if (description) {
								if (description.replaceAll(/\s/g, '').length === 0) {
									description = undefined;
								}
							}
							if (roleplayName && roleplayName !== 'Template') {
								const returned: RoleplayNameData = {
									roleplayName,
									userName: ign,
									description,
								};
								return returned;
							}
						}
					}
					return undefined;
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
			const response = await fetch(
				`https://api.amazingpowerups.com/api/data/v1/boards/${TRELLO_BOARD_ID}/cards?token=${AMAZING_FIELDS_TOKEN}`
			);

			if (!response.ok) {
				throw new Error('Failed to fetch data from API');
			}

			const data = (await response.json()) as any;

			const members = processData(data.cards);
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

			await MY_CACHE.put(cacheKey, JSON.stringify(memberDetails), { expirationTtl: 3600 }); // Cache for 1 hour

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
