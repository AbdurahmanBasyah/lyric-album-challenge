import Link from "next/link";

import { LibraryPicker } from "@/components/library/library-picker";

export const metadata = {
    title: "Choose from your library - FillTheLyrics",
    description:
        "Choose a saved Spotify album or playlist for your lyric challenge.",
};

function BrandMark() {
    return (
        <span className="brand-mark" aria-hidden="true">
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            >
                <path
                    d="M5 15.5V8.5M9.5 18V6M14 15.5V8.5M18.5 13V11"
                    strokeLinecap="round"
                />
            </svg>
        </span>
    );
}

export default function AlbumsPage() {
    return (
        <div className="site-shell">
            <header className="site-header">
                <Link className="brand-lockup" href="/">
                    <BrandMark />
                    <span className="brand-name">
                        <span>FillTheLyrics</span>
                        <span>Saved library</span>
                    </span>
                </Link>
                <Link
                    className="header-pill no-underline transition-colors hover:border-[var(--teal)] hover:text-[var(--foreground)]"
                    href="/"
                >
                    Back home
                </Link>
            </header>

            <main
                id="albums-content"
                className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-0 pb-16 pt-[clamp(4rem,9vw,8rem)] sm:pb-24"
            >
                <section aria-labelledby="albums-heading">
                    <p className="eyebrow">
                        <span className="eyebrow-line" aria-hidden="true" />
                        Your music memory library
                    </p>
                    <div className="mt-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
                        <div className="max-w-2xl">
                            <h1
                                id="albums-heading"
                                className="max-w-[12ch] text-[clamp(2.8rem,7vw,5.7rem)] font-[560] leading-[0.96] tracking-[-0.075em] text-[var(--foreground)]"
                            >
                                Choose your source
                            </h1>
                            <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted-strong)] sm:text-lg">
                                Pick a saved album or playlist from your Spotify
                                library. We&apos;ll use it to shape a focused lyric
                                challenge.
                            </p>
                        </div>
                        <p className="max-w-[17rem] text-sm leading-6 text-[var(--muted)] sm:text-right">
                            Album art, playlist covers, and metadata come from
                            your private library.
                        </p>
                    </div>
                </section>

                <section
                    className="mt-10 border-t border-[var(--border)] pt-6 sm:mt-14 sm:pt-8"
                    aria-labelledby="library-list-heading"
                >
                    <div className="mb-5 flex items-baseline justify-between gap-4">
                        <h2
                            id="library-list-heading"
                            className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]"
                        >
                            Your library
                        </h2>
                        <span className="text-xs uppercase tracking-[0.1em] text-[var(--muted)]">
                            Select an album or playlist
                        </span>
                    </div>
                    <LibraryPicker />
                </section>
            </main>

            <footer className="landing-footer">
                <p>Listen closely. Remember more.</p>
                <p>Playback is optional.</p>
            </footer>
        </div>
    );
}
