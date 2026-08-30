import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    getLibrarySourceForKey,
    type LibrarySource,
} from "./library-picker";

const libraryPickerSource = readFileSync(
    resolve(process.cwd(), "src/components/library/library-picker.tsx"),
    "utf8",
);

describe("library source selection", () => {
    it("defaults to saved albums and composes both source pickers", () => {
        expect(libraryPickerSource).toContain(
            'useState<LibrarySource>("albums")',
        );
        expect(libraryPickerSource).toContain("<AlbumPicker />");
        expect(libraryPickerSource).toContain("<PlaylistPicker />");
    });

    it("switches sources with predictable keyboard navigation", () => {
        expect(getLibrarySourceForKey("albums", "ArrowRight")).toBe(
            "playlists",
        );
        expect(getLibrarySourceForKey("playlists", "ArrowLeft")).toBe(
            "albums",
        );
        expect(getLibrarySourceForKey("playlists", "Home")).toBe("albums");
        expect(getLibrarySourceForKey("albums", "End")).toBe("playlists");
    });

    it("keeps the active source represented as an accessible tab", () => {
        const sources: LibrarySource[] = ["albums", "playlists"];

        expect(sources).toHaveLength(2);
        expect(libraryPickerSource).toContain('role="tablist"');
        expect(libraryPickerSource).toContain('role="tab"');
        expect(libraryPickerSource).toContain("aria-selected={isSelected}");
        expect(libraryPickerSource).toContain("aria-controls={panelId}");
        expect(libraryPickerSource).toContain('initial={{ opacity: 1');
        expect(libraryPickerSource).toContain("<AnimatePresence");
    });
});
