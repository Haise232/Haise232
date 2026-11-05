// Genera las tarjetas de estadísticas del perfil (assets/estadisticas.svg y assets/lenguajes.svg) con la API GraphQL
// de GitHub. Solo cuenta repos y contribuciones públicas. Sin dependencias: Node 20 o superior.
//   GITHUB_TOKEN=… node scripts/estadisticas.mjs [usuario]
import { writeFile } from 'node:fs/promises'

const USER = process.argv[2] ?? process.env.GITHUB_REPOSITORY_OWNER ?? 'Haise232'
const TOKEN = process.env.GITHUB_TOKEN
if (!TOKEN) throw new Error('Falta GITHUB_TOKEN')

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${TOKEN}`, 'content-type': 'application/json', 'user-agent': 'estadisticas-perfil' },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json()
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body))
  return body.data
}

// Repos propios y públicos (sin forks), con sus lenguajes y estrellas.
const repos = []
for (let after = null; ; ) {
  const d = await gql(
    `query($login: String!, $after: String) {
      user(login: $login) {
        repositories(first: 100, after: $after, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
          pageInfo { hasNextPage endCursor }
          nodes { name stargazerCount languages(first: 12, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } } }
        }
      }
    }`,
    { login: USER, after },
  )
  const page = d.user.repositories
  repos.push(...page.nodes)
  if (!page.pageInfo.hasNextPage) break
  after = page.pageInfo.endCursor
}

// Contribuciones del último año, solo en repos públicos.
const c = (
  await gql(
    `query($login: String!) {
      user(login: $login) {
        name createdAt
        followers { totalCount }
        contributionsCollection {
          contributionCalendar { totalContributions }
          commitContributionsByRepository(maxRepositories: 100) { repository { isPrivate } contributions { totalCount } }
          pullRequestContributionsByRepository(maxRepositories: 100) { repository { isPrivate } contributions { totalCount } }
        }
      }
    }`,
    { login: USER },
  )
).user
const sumPublic = (list) => list.filter((r) => !r.repository.isPrivate).reduce((n, r) => n + r.contributions.totalCount, 0)
const commits = sumPublic(c.contributionsCollection.commitContributionsByRepository)
const prs = sumPublic(c.contributionsCollection.pullRequestContributionsByRepository)
const stars = repos.reduce((n, r) => n + r.stargazerCount, 0)

const langs = new Map()
for (const r of repos) {
  for (const e of r.languages.edges) {
    const l = langs.get(e.node.name) ?? { name: e.node.name, color: e.node.color ?? '#8b949e', size: 0 }
    l.size += e.size
    langs.set(e.node.name, l)
  }
}
const total = [...langs.values()].reduce((n, l) => n + l.size, 0) || 1
const top = [...langs.values()].sort((a, b) => b.size - a.size).slice(0, 8)

// --- Dibujo (colores del tema tokyonight) ---
const T = { bg: '#1a1b27', title: '#70a5fd', text: '#38bdae', muted: '#a9b1d6', icon: '#bf91f3', track: '#2b2d42' }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
const fmt = (n) => n.toLocaleString('es-ES')
const font = `font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif"`
const W = 450
const H = 195

const rows = [
  stars > 0 ? ['⭐', 'Estrellas', stars] : ['📅', 'En GitHub desde', new Date(c.createdAt).getFullYear()],
  ['📝', 'Commits (último año)', commits],
  ['🔀', 'Pull requests (último año)', prs],
  ['📦', 'Repos públicos', repos.length],
  ['🔥', 'Contribuciones (último año)', c.contributionsCollection.contributionCalendar.totalContributions],
  ['👥', 'Seguidores', c.followers.totalCount],
]
const stats = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estadísticas de GitHub de ${esc(USER)}">
  <rect width="${W}" height="${H}" rx="8" fill="${T.bg}"/>
  <text x="25" y="35" ${font} font-size="18" font-weight="600" fill="${T.title}">Estadísticas de ${esc(c.name || USER)}</text>
  ${rows
    .map(
      ([icon, label, value], i) => `<g transform="translate(25 ${62 + i * 22})">
    <text x="0" y="0" font-size="13">${icon}</text>
    <text x="24" y="0" ${font} font-size="14" fill="${T.muted}">${esc(label)}:</text>
    <text x="300" y="0" ${font} font-size="14" font-weight="700" fill="${T.text}" text-anchor="end">${label === 'En GitHub desde' ? value : fmt(value)}</text>
  </g>`,
    )
    .join('\n  ')}
  <g transform="translate(375 105)">
    <circle r="42" fill="none" stroke="${T.track}" stroke-width="7"/>
    <circle r="42" fill="none" stroke="${T.icon}" stroke-width="7" stroke-linecap="round" transform="rotate(-90)"
      stroke-dasharray="${(2 * Math.PI * 42).toFixed(1)}" stroke-dashoffset="${(2 * Math.PI * 42 * (1 - Math.min(1, commits / 500))).toFixed(1)}"/>
    <text y="6" ${font} font-size="22" font-weight="800" fill="${T.title}" text-anchor="middle">${fmt(commits)}</text>
    <text y="24" ${font} font-size="10" fill="${T.muted}" text-anchor="middle">commits</text>
  </g>
</svg>
`

const LH = 76 + Math.ceil(top.length / 2) * 26
let x = 25
const bar = top
  .map((l) => {
    const w = (l.size / total) * (W - 50)
    const seg = `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`
    x += w
    return seg
  })
  .join('')
const lenguajes = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LH}" viewBox="0 0 ${W} ${LH}" role="img" aria-label="Lenguajes más usados por ${esc(USER)}">
  <rect width="${W}" height="${LH}" rx="8" fill="${T.bg}"/>
  <text x="25" y="35" ${font} font-size="18" font-weight="600" fill="${T.title}">Lenguajes más usados</text>
  <clipPath id="b"><rect x="25" y="0" width="${W - 50}" height="8" rx="4"/></clipPath>
  <g transform="translate(0 50)" clip-path="url(#b)">${bar}</g>
  ${top
    .map((l, i) => {
      const cx = 25 + (i % 2) * 205
      const cy = 82 + Math.floor(i / 2) * 26
      return `<g transform="translate(${cx} ${cy})"><circle cx="5" cy="-4" r="5" fill="${l.color}"/><text x="16" y="0" ${font} font-size="13" fill="${T.muted}">${esc(l.name)} <tspan fill="${T.text}" font-weight="700">${((l.size / total) * 100).toFixed(1).replace('.', ',')} %</tspan></text></g>`
    })
    .join('\n  ')}
</svg>
`

await writeFile('assets/estadisticas.svg', stats)
await writeFile('assets/lenguajes.svg', lenguajes)
console.log(`Listo: ${repos.length} repos, ${stars} estrellas, ${commits} commits, ${prs} PRs, ${top.map((l) => l.name).join(', ')}`)
