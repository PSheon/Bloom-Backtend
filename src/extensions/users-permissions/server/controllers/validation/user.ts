import { yup, validateYupSchema } from "@strapi/utils";

const deleteRoleSchema = yup.object().shape({
  role: yup.strapiID().required(),
});

const createUserBodySchema = yup.object().shape({
  email: yup.string().email().required(),
  username: yup.string().min(1).required(),
  password: yup.string().min(1).required(),
  role: yup.lazy((value) =>
    typeof value === "object"
      ? yup
          .object()
          .shape({
            connect: yup
              .array()
              .of(yup.object().shape({ id: yup.strapiID().required() }))
              .min(1, "Users must have a role")
              .required(),
          })
          .required()
      : yup.strapiID().required()
  ),
});

const updateUserBodySchema = yup.object().shape({
  email: yup.string().email().min(1),
  username: yup.string().min(1),
  password: yup.string().min(1),
  role: yup.lazy((value) =>
    typeof value === "object"
      ? yup.object().shape({
          connect: yup
            .array()
            .of(yup.object().shape({ id: yup.strapiID().required() }))
            .required(),
          disconnect: yup
            .array()
            .test(
              "CheckDisconnect",
              "Cannot remove role",
              function test(disconnectValue) {
                if (value.connect.length === 0 && disconnectValue.length > 0) {
                  return false;
                }

                return true;
              }
            )
            .required(),
        })
      : yup.strapiID()
  ),
});

const updateMeUserBodySchema = yup.object().shape({
  title: yup.string().nullable(),
  phone: yup.string().nullable(),
});

export const validateCreateUserBody = validateYupSchema(createUserBodySchema);
export const validateUpdateUserBody = validateYupSchema(updateUserBodySchema);
export const validateDeleteRoleBody = validateYupSchema(deleteRoleSchema);
export const validateUpdateMeUserBody = validateYupSchema(
  updateMeUserBodySchema
);
