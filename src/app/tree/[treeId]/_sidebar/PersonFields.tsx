import { Clipboard, Mars, Upload, Venus, X } from "lucide-react"
import { useEffect, useState } from "react"
import { AvatarCropper } from "@/components/AvatarCropper"
import { fileToImageSrc } from "@/lib/image"
import type { Gender } from "@/types"
import { type Fields, inputCls, labelCls } from "./shared"

const GENDER_OPTIONS: {
  value: Gender
  label: string
  Icon: typeof Mars
  active: string
}[] = [
  {
    value: "male",
    label: "Male",
    Icon: Mars,
    active: "border-transparent bg-sky-100 text-sky-700 ring-1 ring-sky-300",
  },
  {
    value: "female",
    label: "Female",
    Icon: Venus,
    active: "border-transparent bg-rose-100 text-rose-700 ring-1 ring-rose-300",
  },
]

export function PersonFields({
  fields,
  onChange,
}: {
  fields: Fields
  onChange: (f: Fields) => void
}) {
  const [photoError, setPhotoError] = useState<string>()
  const [cropSrc, setCropSrc] = useState<string>()

  async function startCrop(file: File | Blob | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setPhotoError("That wasn't an image file.")
      return
    }
    setPhotoError(undefined)
    try {
      setCropSrc(await fileToImageSrc(file))
    } catch (err) {
      console.error(err)
      setPhotoError("Could not read that image, try another file.")
    }
  }

  // Allow pasting an image from the clipboard while this form is open.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/"),
      )
      const file = item?.getAsFile()
      if (file) {
        event.preventDefault()
        startCrop(file)
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="field-name"
          className={labelCls}
        >
          Name *
        </label>
        <input
          id="field-name"
          required
          value={fields.name}
          onChange={(e) => onChange({ ...fields, name: e.target.value })}
          placeholder="e.g. Grace Tan"
          className={inputCls}
        />
      </div>

      <div>
        <span className={labelCls}>Gender</span>
        <div className="flex gap-2">
          {GENDER_OPTIONS.map(({ value, label, Icon, active }) => {
            const selected = fields.gender === value
            return (
              <button
                key={value}
                type="button"
                title={label}
                aria-pressed={selected}
                onClick={() =>
                  onChange({ ...fields, gender: selected ? "" : value })
                }
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all active:scale-95 ${
                  selected
                    ? active
                    : "border-slate-200 bg-slate-50/60 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="field-dob"
            className={labelCls}
          >
            Born
          </label>
          <input
            id="field-dob"
            type="date"
            value={fields.dob}
            onChange={(e) => onChange({ ...fields, dob: e.target.value })}
            className={inputCls}
          />
        </div>
        <div>
          <label
            htmlFor="field-dod"
            className={labelCls}
          >
            Died
          </label>
          <input
            id="field-dod"
            type="date"
            value={fields.dod}
            onChange={(e) => onChange({ ...fields, dod: e.target.value })}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="field-location"
          className={labelCls}
        >
          Location
        </label>
        <input
          id="field-location"
          value={fields.location}
          onChange={(e) => onChange({ ...fields, location: e.target.value })}
          placeholder="e.g. Singapore"
          className={inputCls}
        />
      </div>

      <div>
        <span className={labelCls}>Photo</span>
        <div className="flex items-center gap-3">
          {fields.photo ? (
            // biome-ignore lint/performance/noImgElement: data-URL preview of an uploaded photo
            <img
              src={fields.photo}
              alt="preview"
              className="h-12 w-12 rounded-full object-cover ring-2 ring-cobalt-100"
            />
          ) : (
            <div className="h-12 w-12 rounded-full bg-slate-100 ring-2 ring-slate-200" />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-cobalt-50 px-3 py-1.5 text-xs font-medium text-cobalt-600 transition-colors hover:bg-cobalt-100">
              <Upload className="h-3.5 w-3.5" /> Upload
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  startCrop(e.target.files?.[0])
                  e.target.value = ""
                }}
                className="hidden"
              />
            </label>
            {fields.photo && (
              <button
                type="button"
                onClick={() => onChange({ ...fields, photo: undefined })}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-400">
          <Clipboard className="h-3 w-3" /> You can also paste an image from
          your clipboard (Ctrl/Cmd+V).
        </p>
        {photoError && (
          <p className="mt-1 text-xs text-red-500">{photoError}</p>
        )}
      </div>

      {cropSrc && (
        <AvatarCropper
          src={cropSrc}
          onCancel={() => setCropSrc(undefined)}
          onConfirm={(avatar) => {
            onChange({ ...fields, photo: avatar })
            setCropSrc(undefined)
          }}
        />
      )}
    </div>
  )
}
