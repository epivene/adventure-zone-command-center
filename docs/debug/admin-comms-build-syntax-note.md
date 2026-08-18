# Admin communications build syntax fix

Render production build failed parsing `ManagerCommunicationsAdminPage.tsx` because two `apiPost` response generic types were missing the closing `}` for the response object type. Both call sites now use `apiPost<{ message: Message; acknowledgments?: Array<{ id: string }> }>(...)`.
