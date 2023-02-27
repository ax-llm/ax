import axios, { AxiosResponse } from 'axios';

export type API = {
  key: string;
  name: string;
  url: string;
  headers?: any;
};

export const apiCall = <APIType extends API, Request, Response>(
  api: APIType,
  data: Request
): Promise<AxiosResponse<Response, any>> => {
  const headers = {
    Authorization: `Bearer ${api.key}`,
    ...api.headers,
  };

  return axios.post(new URL(api.name, api.url).href, data, {
    headers,
  });
};
