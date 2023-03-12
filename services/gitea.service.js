"use strict";
const f = require("cross-fetch");
const ConfigLoader = require("config-mixin");

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

/** @type {ServiceSchema} */
module.exports = {
	name: "gitea",
	version: 1,

	mixins: [
		ConfigLoader(['gitea.**']),
	],

	/**
	 * Settings
	 */
	settings: {
		rest: true
	},

	/**
	 * Dependencies
	 */
	dependencies: [],

	/**
	 * Actions
	 */
	actions: {
		webhook: {
			rest: 'POST /',
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				console.log(Object.keys(params), params)
				if (params.head_commit) {
					const commitData = params.head_commit;

					const owner = await ctx.call('v1.accounts.find', {
						query: { username: params.repository.owner.username }
					}).then((res) => res.shift())
					const pusher = await ctx.call('v1.accounts.find', {
						query: { username: params.pusher.username }
					}).then((res) => res.shift())
					const repo = await ctx.call('v1.repos.getRepo', {
						name: params.repository.name
					})

					const commit = await ctx.call('v1.repos.commits.create', {
						repo: repo.id,
						name: repo.name,
						status: 'accepted',
						hash: commitData.id,
						branch: params.ref.split('/').pop(),
						action: 'push',
						message: commitData.message,
						added: commitData.added,
						removed: commitData.removed,
						modified: commitData.modified,
						commits: params.total_commits,
					}, { meta: { userID: owner.id } })

					this.logger.info(`New commit ${commit.hash})(${commit.id}) has been summited by ${pusher.username}(${pusher.id})`)

				}

				await ctx.emit('gitea.webhook', params);

				return {}
			}
		},
		'users.list': {
			async handler() {
				return this.get(`admin/users`)
			}
		},
		'users.create': {
			params: {
				email: { type: "string", optional: false },
				username: { type: "string", optional: false },
				password: { type: "string", optional: false },
				full_name: { type: "string", optional: true },
				login_name: { type: "string", optional: true },
				visibility: {
					type: "enum",
					values: ["public", "limited", "private"],
					default: "private",
					optional: true
				},
			},
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				return this.post(`admin/users`, {
					"email": params.email,
					"username": params.username,
					"password": params.password,
					"full_name": params.full_name || params.username,
					"login_name": params.login_name || params.username,
					"must_change_password": false,
					"restricted": true,
					"send_notify": true,
					//"source_id": 0,
					"visibility": "private"
				})
			}
		},
		'users.remove': {
			params: {
				username: { type: "string", optional: false },
			},
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				return this.delete(`admin/users/${params.username}`)
			}
		},
		'repos.get': {
			params: {
				username: { type: "string", optional: false },
				repo: { type: "string", optional: false },
			},
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				return this.get(`repos/${params.username}/${params.repo}`)
			}
		},
		'repos.create': {
			params: {
				name: { type: "string", optional: false },
				username: { type: "string", optional: false },
				default_branch: { type: "string", default: "main", optional: true },
				auto_init: { type: "boolean", default: true, optional: true },
				private: { type: "boolean", default: true, optional: true },
				description: { type: "string", optional: true },
				gitignores: { type: "string", optional: true },
				license: { type: "string", optional: true },
				readme: { type: "string", optional: true },
				trust_model: {
					type: "enum",
					values: ["default", "collaborator", "committer", "collaboratorcommitter"],
					default: "default",
					optional: true
				},
			},
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				return this.post(`admin/users/${params.username}/repos`, {
					"auto_init": params.auto_init,
					"default_branch": params.default_branch,
					"description": params.description,
					"gitignores": params.gitignores,
					"issue_labels": params.issue_labels,
					"license": params.license,
					"name": params.name,
					"private": params.private,
					"readme": params.readme,
					"template": false,
					"trust_model": params.trust_model,
				})
			}
		},
		'repos.remove': {
			params: {
				username: { type: "string", optional: false },
				name: { type: "string", optional: false },
			},
			async handler(ctx) {
				const params = Object.assign({}, ctx.params);
				return this.delete(`repos/${params.username}/${params.name}`)
			}
		},

	},

	/**
	 * Events
	 */
	events: {
		async "repos.created"(ctx) {
			const repo = ctx.params.data;

			const owner = await ctx.call('v1.accounts.resolve', { id: repo.owner })
			const result = await this.actions['repos.create']({
				name: repo.name,
				username: owner.username
			})

			console.log(result)
		},
		async "repos.removed"(ctx) {
			const repo = ctx.params.data;

			const owner = await ctx.call('v1.accounts.resolve', { id: repo.owner })
			const result = await this.actions['repos.remove']({
				name: repo.name,
				username: owner.username
			})

			console.log(result)
		},
	},

	/**
	 * Methods
	 */
	methods: {
		async get(url) {
			const api = this.config["gitea.api"];
			const key = this.config["gitea.key"];
			return f(`${api}/${url}`, {
				method: "GET",
				headers: {
					"Authorization": `token ${key}`,
				}
			}).then(res => res.json().catch());
		},
		async delete(url) {
			const api = this.config["gitea.api"];
			const key = this.config["gitea.key"];
			return f(`${api}/${url}`, {
				method: "DELETE",
				headers: {
					"Authorization": `token ${key}`,
				}
			}).then(async (res) => {
				const text = await res.text();
				if (text == '') {
					return true
				} else {
					throw new Error(text)
				}
			});
		},
		async post(url, body) {
			const api = this.config["gitea.api"];
			const key = this.config["gitea.key"];
			return f(`${api}/${url}`, {
				method: "POST",
				headers: {
					"Authorization": `token ${key}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify(body)
			}).then(res => res.json().catch());
		}
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {

	},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {

	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {

	}
};
