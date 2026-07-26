import { searchPeople } from "@/server/handlers/people-v2"

export const runtime = "nodejs"

export const GET = searchPeople
