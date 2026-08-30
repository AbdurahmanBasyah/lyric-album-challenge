"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { AlbumPicker } from "../albums/album-picker";
import { PlaylistPicker } from "../playlists/playlist-picker";

export type LibrarySource = "albums" | "playlists";

const SOURCE_LABELS: Readonly<Record<LibrarySource, string>> = {
    albums: "Saved albums",
    playlists: "Playlists",
};
const SOURCE_KEYS: readonly LibrarySource[] = ["albums", "playlists"];

export type LibrarySourceKey = "ArrowRight" | "ArrowLeft" | "Home" | "End";

export function getLibrarySourceForKey(
    source: LibrarySource,
    key: LibrarySourceKey,
): LibrarySource {
    const currentIndex = SOURCE_KEYS.indexOf(source);
    const nextIndex =
        key === "Home"
            ? 0
            : key === "End"
              ? SOURCE_KEYS.length - 1
              : (currentIndex + (key === "ArrowRight" ? 1 : -1) + SOURCE_KEYS.length) %
                SOURCE_KEYS.length;

    return SOURCE_KEYS[nextIndex] ?? "albums";
}

export function LibraryPicker() {
    const [source, setSource] = useState<LibrarySource>("albums");

    return (
        <div className="space-y-6">
            <div
                className="inline-flex w-full max-w-md rounded-full border border-[var(--border)] bg-[rgba(13,25,29,0.62)] p-1"
                role="tablist"
                aria-label="Choose a library source"
            >
                {SOURCE_KEYS.map((item) => {
                    const isSelected = source === item;
                    const tabId = `library-tab-${item}`;
                    const panelId = `library-panel-${item}`;

                    return (
                        <button
                            className={`min-h-11 flex-1 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none ${
                                isSelected
                                    ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                                    : "text-[var(--muted-strong)] hover:text-[var(--foreground)]"
                            }`}
                            key={item}
                            id={tabId}
                            type="button"
                            role="tab"
                            aria-selected={isSelected}
                            aria-controls={panelId}
                            tabIndex={isSelected ? 0 : -1}
                            onClick={() => setSource(item)}
                            onKeyDown={(event) => {
                                if (
                                    event.key !== "ArrowRight" &&
                                    event.key !== "ArrowLeft" &&
                                    event.key !== "Home" &&
                                    event.key !== "End"
                                ) {
                                    return;
                                }

                                event.preventDefault();
                                const nextSource = getLibrarySourceForKey(
                                    item,
                                    event.key as LibrarySourceKey,
                                );
                                setSource(nextSource);
                                document
                                    .getElementById(`library-tab-${nextSource}`)
                                    ?.focus();
                            }}
                        >
                            {SOURCE_LABELS[item]}
                        </button>
                    );
                })}
            </div>

            <AnimatePresence initial={false} mode="wait">
                <motion.div
                    key={source}
                    id={`library-panel-${source}`}
                    role="tabpanel"
                    aria-labelledby={`library-tab-${source}`}
                    initial={{ opacity: 1, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.28, ease: "easeOut" }}
                >
                    {source === "albums" ? <AlbumPicker /> : <PlaylistPicker />}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
