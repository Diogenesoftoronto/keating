self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});

			await Promise.allSettled(
				windows.map((client) => {
					if (!("navigate" in client)) return Promise.resolve();
					return client.navigate(client.url);
				}),
			);
		})(),
	);
});
