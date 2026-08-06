import { Body, Head, Html } from "@react-email/components"
import { render } from "@react-email/render"
import type { ReactNode } from "react"

export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

type BannerTone = "success" | "danger"

const BANNER: Record<
  BannerTone,
  { bg: string; border: string; color: string; badge: string }
> = {
  success: {
    bg: "#ecfdf5",
    border: "#a7f3d0",
    color: "#047857",
    badge: "\u2713",
  },
  danger: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c", badge: "!" },
}

function Banner({ tone, children }: { tone: BannerTone; children: ReactNode }) {
  const style = BANNER[tone]
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{
        marginTop: 24,
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 14,
      }}
    >
      <tr>
        <td
          style={{
            padding: "12px 14px",
            fontFamily: FONT_STACK,
            fontSize: 14,
            lineHeight: "20px",
            color: style.color,
          }}
        >
          <span
            style={{
              display: "inline-block",
              minWidth: 20,
              height: 20,
              lineHeight: "20px",
              textAlign: "center",
              borderRadius: 999,
              background: style.color,
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 700,
              marginRight: 8,
              verticalAlign: "middle",
            }}
          >
            {style.badge}
          </span>
          <span style={{ verticalAlign: "middle" }}>{children}</span>
        </td>
      </tr>
    </table>
  )
}

function Button({ label, href }: { label: string; href: string }) {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
    >
      <tr>
        <td
          align="center"
          style={{ borderRadius: 12, background: "#1f41e0" }}
        >
          <a
            href={href}
            target="_blank"
            style={{
              display: "inline-block",
              padding: "12px 24px",
              fontFamily: FONT_STACK,
              fontSize: 14,
              fontWeight: 600,
              color: "#ffffff",
              textDecoration: "none",
            }}
            rel="noopener"
          >
            {label}
          </a>
        </td>
      </tr>
    </table>
  )
}

function CardEmail({ children }: { children: ReactNode }) {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        />
        <title>FamiKi</title>
      </Head>
      <Body
        style={{
          margin: 0,
          padding: 0,
          background: "#f7f4ed",
          fontFamily: FONT_STACK,
        }}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ background: "#f7f4ed" }}
        >
          <tr>
            <td
              align="center"
              style={{ padding: "32px 16px" }}
            >
              <table
                role="presentation"
                width={480}
                cellPadding={0}
                cellSpacing={0}
                style={{
                  maxWidth: 480,
                  width: "100%",
                  background: "#ffffff",
                  border: "1px solid #f0ece2",
                  borderRadius: 28,
                  boxShadow: "0 28px 70px rgba(47,39,27,0.11)",
                }}
              >
                <tr>
                  <td
                    align="center"
                    style={{ padding: "36px 32px" }}
                  >
                    <table
                      role="presentation"
                      cellPadding={0}
                      cellSpacing={0}
                      align="center"
                    >
                      <tr>
                        <td
                          style={{
                            fontFamily: FONT_STACK,
                            fontSize: 18,
                            fontWeight: 700,
                            letterSpacing: "-0.04em",
                            color: "#27241f",
                            verticalAlign: "middle",
                          }}
                        >
                          FamiKi
                        </td>
                      </tr>
                    </table>
                    {children}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </Body>
    </Html>
  )
}

type TreeStatusInput = {
  treeName: string
  treeUrl: string
  bannerTone: BannerTone
  bannerText: string
  bodyLine1: string
  bodyLine2: string
  buttonLabel: string
}

function TreeStatusEmail({
  treeName,
  treeUrl,
  bannerTone,
  bannerText,
  bodyLine1,
  bodyLine2,
  buttonLabel,
}: TreeStatusInput) {
  return (
    <CardEmail>
      <Banner tone={bannerTone}>{bannerText}</Banner>
      <h1
        style={{
          margin: "24px 0 4px",
          fontSize: 24,
          lineHeight: "1.1",
          fontWeight: 700,
          letterSpacing: "-0.045em",
          color: "#27241f",
          textAlign: "center",
        }}
      >
        {`"${treeName}"`}
      </h1>
      <p
        style={{
          margin: "0 0 20px",
          fontSize: 13,
          fontWeight: 600,
          color: "#9b9384",
          textAlign: "center",
        }}
      >
        Family tree
      </p>
      <p
        style={{
          margin: "0 0 24px",
          fontSize: 15,
          lineHeight: "24px",
          color: "#686155",
          textAlign: "center",
        }}
      >
        {bodyLine1}
        <br />
        {bodyLine2}
      </p>
      <Button
        label={buttonLabel}
        href={treeUrl}
      />
    </CardEmail>
  )
}

type AccessRequestOwnerInput = {
  requesterName: string
  requesterEmail: string
  treeName: string
  comment: string
  reviewUrl: string
}

function AccessRequestOwnerEmail({
  requesterName,
  requesterEmail,
  treeName,
  comment,
  reviewUrl,
}: AccessRequestOwnerInput) {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        />
        <title>FamiKi</title>
      </Head>
      <Body style={{ margin: 0, padding: 0, fontFamily: FONT_STACK }}>
        <p>
          <strong>{requesterName}</strong> ({requesterEmail}) requested access
          to your tree "{treeName}".
        </p>
        <p>
          <em>Note:</em> {comment}
        </p>
        <p>
          <a href={reviewUrl}>Review the request</a>
        </p>
      </Body>
    </Html>
  )
}

export async function renderTreeStatusHtml(
  input: TreeStatusInput,
): Promise<string> {
  return render(<TreeStatusEmail {...input} />)
}

export async function renderAccessRequestOwnerHtml(
  input: AccessRequestOwnerInput,
): Promise<string> {
  return render(<AccessRequestOwnerEmail {...input} />)
}
