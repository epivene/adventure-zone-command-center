export type DevelopmentSampleLogins = {
  office: {
    loginName: string;
    password: string;
  };
  manager: {
    legId: string;
    legName: string;
    password: string;
  };
};

const apiRoot = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export async function loadDevelopmentSampleLogins(): Promise<DevelopmentSampleLogins | null> {
  if (!import.meta.env.DEV) return null;

  try {
    const response = await fetch(`${apiRoot}/dev/sample-logins`);
    if (!response.ok) return null;
    return (await response.json()) as DevelopmentSampleLogins;
  } catch {
    return null;
  }
}