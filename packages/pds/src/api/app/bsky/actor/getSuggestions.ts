import AppContext from '../../../../context'
import { notSoftDeletedClause } from '../../../../db/util'
import { Server } from '../../../../lexicon'
import { getDeclarationSimple } from '../util'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.actor.getSuggestions({
    auth: ctx.accessVerifier,
    handler: async ({ params, auth }) => {
      let { limit } = params
      const { cursor } = params
      const requester = auth.credentials.did
      limit = Math.min(limit ?? 25, 100)

      const db = ctx.db.db
      const { ref } = db.dynamic

      const suggestionsReq = db
        .selectFrom('user')
        .innerJoin('did_handle', 'user.handle', 'did_handle.handle')
        .innerJoin('repo_root', 'repo_root.did', 'did_handle.did')
        .leftJoin('profile', 'profile.creator', 'did_handle.did')
        .where(notSoftDeletedClause(ref('repo_root')))
        .select([
          'did_handle.did as did',
          'did_handle.handle as handle',
          'did_handle.actorType as actorType',
          'did_handle.declarationCid as declarationCid',
          'profile.uri as profileUri',
          'profile.displayName as displayName',
          'profile.description as description',
          'profile.avatarCid as avatarCid',
          'profile.indexedAt as indexedAt',
          'user.createdAt as createdAt',
          db
            .selectFrom('follow')
            .where('creator', '=', requester)
            .whereRef('subjectDid', '=', ref('did_handle.did'))
            .select('uri')
            .as('requesterFollow'),
        ])
        .orderBy(ref('user.createdAt'), 'asc')
        .if(limit !== undefined, (q) => q.limit(limit as number))
        .if(cursor !== undefined, (q) =>
          q.where(ref('user.createdAt'), '>', cursor),
        )

      const suggestionsRes = await suggestionsReq.execute()

      const actors = suggestionsRes.map((result) => ({
        did: result.did,
        handle: result.handle,
        declaration: getDeclarationSimple(result),
        displayName: result.displayName ?? undefined,
        description: result.description ?? undefined,
        avatar: result.avatarCid
          ? ctx.imgUriBuilder.getCommonSignedUri('avatar', result.avatarCid)
          : undefined,
        indexedAt: result.indexedAt ?? undefined,
        myState: {
          follow: result.requesterFollow || undefined,
        },
      }))

      const lastResult = suggestionsRes.at(-1)
      return {
        encoding: 'application/json',
        body: {
          actors,
          cursor: lastResult?.createdAt,
        },
      }
    },
  })
}
