export const POST_ANSWER_ORIGIN = 'https://x.com';
export function isPostAnswer(
  response: {
    method: string;
    url: string;
    status: number;
    contentType: string | null;
  },
  focalId: string,
  origin = POST_ANSWER_ORIGIN,
): boolean {
  try {
    const url = new URL(response.url),
      variables: unknown = JSON.parse(
        url.searchParams.get('variables') ?? 'null',
      );
    return (
      response.method === 'GET' &&
      url.origin === origin &&
      /^\/i\/api\/graphql\/[A-Za-z0-9_-]{1,64}\/TweetDetail$/.test(
        url.pathname,
      ) &&
      variables !== null &&
      typeof variables === 'object' &&
      !Array.isArray(variables) &&
      'focalTweetId' in variables &&
      variables.focalTweetId === focalId &&
      response.status === 200 &&
      Boolean(response.contentType?.startsWith('application/json'))
    );
  } catch {
    return false;
  }
}
export function unexpectedAction(
  method: string,
  url: string,
  origin = POST_ANSWER_ORIGIN,
): boolean {
  const target = new URL(url);
  if (method === 'GET' || target.origin !== origin) return false;
  return (
    /^\/i\/api\/graphql\/[A-Za-z0-9_-]{1,64}\/(?:CreateTweet|CreateNoteTweet|DeleteTweet|FavoriteTweet|UnfavoriteTweet|CreateRetweet|DeleteRetweet|CreateBookmark|DeleteBookmark)$/.test(
      target.pathname,
    ) ||
    [
      '/i/api/1.1/friendships/create.json',
      '/i/api/1.1/friendships/destroy.json',
      '/i/api/1.1/blocks/create.json',
      '/i/api/1.1/mutes/users/create.json',
      '/i/api/1.1/mutes/users/destroy.json',
      '/i/api/1.1/blocks/destroy.json',
      '/i/api/1.1/dm/new2.json',
      '/i/api/1.1/account/settings.json',
      '/i/api/1.1/account/update_profile.json',
    ].includes(target.pathname)
  );
}
