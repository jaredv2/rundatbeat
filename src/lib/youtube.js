const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY;

export async function searchYouTube(query) {
  const encoded = encodeURIComponent(query);

  if (API_KEY) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encoded}&type=video&maxResults=3&key=${API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`YouTube API ${res.status}`);
      const data = await res.json();
      return (data.items || []).map((item) => ({
        title: item.snippet.title,
        videoId: item.id.videoId,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        thumb: item.snippet.thumbnails?.default?.url,
      }));
    } catch (err) {
      console.error('[YouTube] API search failed, falling back:', err.message);
    }
  }

  return [{
    title: `Search "${query}"`,
    videoId: null,
    url: `https://www.youtube.com/results?search_query=${encoded}`,
    thumb: null,
  }];
}

export function youtubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
