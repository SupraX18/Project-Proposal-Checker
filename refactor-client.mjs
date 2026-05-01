import fs from 'fs';
import path from 'path';

const file = 'frontend/src/app/api/client.ts';
let content = fs.readFileSync(file, 'utf8');

// Remove types
content = content.replace(/export type EvaluationScores = \{[\s\S]*?\};\n/g, '');
content = content.replace(/export type EvaluationRecommendation = "Approve" | "Revise" | "Reject";\n/g, '');
content = content.replace(/export type ProposalEvaluation = \{[\s\S]*?\};\n/g, '');
content = content.replace(/export type SimilarityReport = \{[\s\S]*?\};\n/g, '');
content = content.replace(/export type WorkspaceSettings = \{[\s\S]*?\};\n/g, '');

// Clean up Proposal types
content = content.replace(/evaluation: ProposalEvaluation \| null;\n/g, '');
content = content.replace(/reviewer: string \| null;\n/g, '');

// Add color to folder
content = content.replace(/export type Folder = \{[\s\S]*?student_id: string;/, 'export type Folder = {\n  id: string;\n  name: string;\n  parent_id: string | null;\n  student_id: string;\n  color: string;');

// Remove old API functions
content = content.replace(/export async function getWorkspaceSettings[\s\S]*?\n\}\n/g, '');
content = content.replace(/export async function updateWorkspaceSettings[\s\S]*?\n\}\n/g, '');
content = content.replace(/export async function getSimilarityReport[\s\S]*?\n\}\n/g, '');
content = content.replace(/export async function saveProposalEvaluation[\s\S]*?\n\}\n/g, '');

// Add Status update API
const statusApi = `
export async function updateProposalStatus(id: string, status: ProposalStatus): Promise<{ success: boolean; status: ProposalStatus }> {
  return request<{ success: boolean; status: ProposalStatus }>(\`/proposals/\${id}/status\`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
`;
content = content.replace(/export async function createProposal/, statusApi + '\nexport async function createProposal');

// Add User management API
const usersApi = `
export async function createUser(data: Partial<AuthUser> & { password?: string }): Promise<{ id: string }> {
  return request<{ id: string }>("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id: string): Promise<void> {
  return request<void>(\`/users/\${id}\`, { method: "DELETE" });
}
`;
content = content.replace(/export async function listUsers/, usersApi + '\nexport async function listUsers');

// Update createFolder to accept color
content = content.replace(/export async function createFolder\(name: string, parentId\?: string\)/, 'export async function createFolder(name: string, color?: string, parentId?: string)');
content = content.replace(/body: JSON\.stringify\(\{ name, parent_id: parentId \}\),/, 'body: JSON.stringify({ name, color, parent_id: parentId }),');

fs.writeFileSync(file, content);
console.log('Client API Refactored');
