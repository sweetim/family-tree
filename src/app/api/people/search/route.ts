import { searchPeople } from "@/server/handlers/people"

export const runtime = "nodejs"

export const GET = searchPeople
