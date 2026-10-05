export type ImageKitConfig = { privateKey: string; urlEndpoint: string; folder: string };

/** No credentials means the optional image service is disabled. Never echo secrets. */
export function loadImageKitConfig(env: NodeJS.ProcessEnv = process.env): ImageKitConfig | null {
  const values = [env.IMAGEKIT_PRIVATE_KEY, env.IMAGEKIT_URL_ENDPOINT, env.IMAGEKIT_FOLDER];
  if (values.every((value) => !value)) return null;
  try {
    if (values.some((value) => !value?.trim())) throw new Error();
    const privateKey = env.IMAGEKIT_PRIVATE_KEY!;
    if (!/^private_\S{8,}$/.test(privateKey)) throw new Error();
    const endpoint = new URL(env.IMAGEKIT_URL_ENDPOINT!);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !/^\/[A-Za-z0-9_/-]*$/.test(endpoint.pathname)) throw new Error();
    const folder = env.IMAGEKIT_FOLDER!.replace(/^\/+|\/+$/g, "");
    if (folder.length > 180 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(folder)) throw new Error();
    return { privateKey, urlEndpoint: endpoint.href.replace(/\/+$/, ""), folder };
  } catch {
    throw new Error("Set all three backend image variables: IMAGEKIT_PRIVATE_KEY (private key), IMAGEKIT_URL_ENDPOINT (HTTPS URL without credentials/query), and IMAGEKIT_FOLDER (for example scribble/dev)");
  }
}
